import { NextResponse } from "next/server";
import { ApiFailure, asArray, errorResponse, providerJson, serverKey, validCoordinate } from "@/lib/server/providers";

type ForecastItem = {
  baseDate?: string;
  baseTime?: string;
  fcstDate?: string;
  fcstTime?: string;
  category?: string;
  fcstValue?: string;
};
type ForecastResponse = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCount?: number; items?: { item?: ForecastItem | ForecastItem[] } };
  };
};

const releaseHours = [23, 20, 17, 14, 11, 8, 5, 2];
const kstOffsetMs = 9 * 60 * 60 * 1000;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function forecastBaseCandidates() {
  const kstNow = new Date(Date.now() + kstOffsetMs);
  const today = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  const hour = kstNow.getUTCHours();
  const candidates: Array<{ date: string; time: string }> = [];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const day = new Date(today.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    for (const releaseHour of releaseHours) {
      if (dayOffset === 0 && releaseHour > hour) continue;
      candidates.push({ date: dateKey(day), time: String(releaseHour).padStart(2, "0") + "00" });
    }
  }
  return { kstNow, candidates };
}

function formatDateTime(date: string, time: string) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`;
}

function gridFromCoordinates(longitude: number, latitude: number) {
  const earthRadiusKm = 6371.00877;
  const gridSpacingKm = 5.0;
  const standardLatitude1 = 30.0;
  const standardLatitude2 = 60.0;
  const originLongitude = 126.0;
  const originLatitude = 38.0;
  const originX = 43;
  const originY = 136;
  const degreesToRadians = Math.PI / 180.0;
  const radius = earthRadiusKm / gridSpacingKm;
  const lat1 = standardLatitude1 * degreesToRadians;
  const lat2 = standardLatitude2 * degreesToRadians;
  const lon0 = originLongitude * degreesToRadians;
  const lat0 = originLatitude * degreesToRadians;
  const sn = Math.log(Math.cos(lat1) / Math.cos(lat2)) / Math.log(Math.tan(Math.PI / 4 + lat2 / 2) / Math.tan(Math.PI / 4 + lat1 / 2));
  const sf = Math.pow(Math.tan(Math.PI / 4 + lat1 / 2), sn) * Math.cos(lat1) / sn;
  const ro = radius * sf / Math.pow(Math.tan(Math.PI / 4 + lat0 / 2), sn);
  const ra = radius * sf / Math.pow(Math.tan(Math.PI / 4 + latitude * degreesToRadians / 2), sn);
  let theta = longitude * degreesToRadians - lon0;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + originX + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + originY + 0.5),
  };
}

async function fetchForecast(baseDate: string, baseTime: string, nx: number, ny: number) {
  const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst");
  url.search = new URLSearchParams({
    ServiceKey: serverKey("DATA_GO_KR_API_KEY"),
    pageNo: "1",
    numOfRows: "1000",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  }).toString();
  return providerJson<ForecastResponse>(url, { revalidate: 60 });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const longitude = validCoordinate(params.get("lng"), 123.310165, 132.774963);
    const latitude = validCoordinate(params.get("lat"), 31.651814, 43.39349);
    if (longitude === null || latitude === null) throw new ApiFailure("대한민국 범위의 출발지 위도·경도를 입력해 주세요.", 400);

    const { nx, ny } = gridFromCoordinates(longitude, latitude);
    const { kstNow, candidates } = forecastBaseCandidates();
    let baseDate = "";
    let baseTime = "";
    let items: ForecastItem[] = [];
    let lastResultCode = "";
    for (const candidate of candidates.slice(0, 5)) {
      const payload = await fetchForecast(candidate.date, candidate.time, nx, ny);
      const response = payload.response;
      const resultCode = response?.header?.resultCode;
      lastResultCode = resultCode ?? "";
      if (resultCode === "03") continue;
      if (resultCode !== "00") {
        if (["20", "30", "31", "32", "33"].includes(resultCode ?? "")) {
          throw new ApiFailure("기상청 API 인증 또는 접근 권한을 확인해 주세요 (공공데이터포털 서비스 키/IP 설정).", 502);
        }
        throw new ApiFailure(`기상청 단기예보 API 응답 오류 (${resultCode ?? "코드 없음"}).`);
      }
      items = asArray(response?.body?.items?.item);
      if (!items.length) continue;
      baseDate = candidate.date;
      baseTime = candidate.time;
      break;
    }
    if (!items.length) {
      throw new ApiFailure(`기상청에서 출발지 격자의 단기예보를 찾지 못했습니다 (${lastResultCode || "자료 없음"}).`, 404);
    }

    const slots = new Map<string, { date: string; time: string; temperature?: number; precipitationProbability?: number }>();
    for (const item of items) {
      if (!item.fcstDate || !item.fcstTime || !item.category) continue;
      const key = `${item.fcstDate}${item.fcstTime}`;
      const slot = slots.get(key) ?? { date: item.fcstDate, time: item.fcstTime };
      const value = Number(item.fcstValue);
      if (item.category === "TMP" && Number.isFinite(value)) slot.temperature = value;
      if (item.category === "POP" && Number.isFinite(value)) slot.precipitationProbability = value;
      slots.set(key, slot);
    }
    const nowKey = `${dateKey(kstNow)}${String(kstNow.getUTCHours()).padStart(2, "0")}${String(kstNow.getUTCMinutes()).padStart(2, "0")}`;
    const availableSlots = [...slots.values()].filter((slot) => slot.temperature !== undefined && slot.precipitationProbability !== undefined).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    const forecast = availableSlots.find((slot) => `${slot.date}${slot.time}` >= nowKey) ?? availableSlots.at(-1);
    if (!forecast) throw new ApiFailure("기상청 응답에 기온과 강수확률 예보가 없습니다.", 404);

    return NextResponse.json({
      temperatureCelsius: forecast.temperature,
      precipitationProbability: forecast.precipitationProbability,
      grid: { nx, ny },
      announcement: { date: baseDate, time: baseTime, dateTime: formatDateTime(baseDate, baseTime) },
      forecast: { date: forecast.date, time: forecast.time, dateTime: formatDateTime(forecast.date, forecast.time) },
      source: "기상청 단기예보 조회서비스",
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } });
  } catch (error) {
    return errorResponse(error);
  }
}
