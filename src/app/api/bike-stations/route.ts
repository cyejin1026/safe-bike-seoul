import { NextResponse } from "next/server";
import { ApiFailure, asArray, errorResponse, providerJson, serverKey, validCoordinate } from "@/lib/server/providers";

type SeoulStation = {
  stationName?: string;
  stationId?: string;
  parkingBikeTotCnt?: string;
  rackTotCnt?: string;
  shared?: string;
  stationLatitude?: string;
  stationLongitude?: string;
};

type SeoulResponse = {
  RESULT?: { CODE?: string; MESSAGE?: string };
  bikeList?: {
    RESULT?: { CODE?: string; MESSAGE?: string };
    list_total_count?: number;
    row?: SeoulStation[] | SeoulStation;
  };
};

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lat = validCoordinate(params.get("lat"), -90, 90);
    const lng = validCoordinate(params.get("lng"), -180, 180);
    if ((params.has("lat") && lat === null) || (params.has("lng") && lng === null) || (lat === null) !== (lng === null)) {
      throw new ApiFailure("lat과 lng에는 올바른 좌표 쌍을 입력해 주세요.", 400);
    }
    const radiusParam = Number(params.get("radius") ?? "3000");
    if (!Number.isFinite(radiusParam) || radiusParam < 100 || radiusParam > 20_000) {
      throw new ApiFailure("radius는 100~20000 미터 범위여야 합니다.", 400);
    }

    const key = serverKey("SEOUL_API_KEY");
    const ranges = [[1, 1000], [1001, 2000], [2001, 3000]] as const;
    const pages = await Promise.all(ranges.map(async ([start, end]) => {
      const url = new URL(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${start}/${end}/`);
      return providerJson<SeoulResponse>(url);
    }));

    if (!pages.some((page) => page.bikeList)) {
      throw new ApiFailure("서울시 API가 따릉이 목록을 반환하지 않았습니다. SEOUL_API_KEY의 유효성 및 서비스 권한을 확인해 주세요.", 502);
    }

    const stations: SeoulStation[] = [];
    for (const page of pages) {
      const data = page.bikeList;
      const result = data?.RESULT ?? page.RESULT;
      if (result && result.CODE !== "INFO-000") {
        const code = result.CODE;
        if (code === "INFO-100") {
          if (/인증키|인증|키가 유효하지/.test(result.MESSAGE ?? "")) {
            throw new ApiFailure("서울시 API 인증에 실패했습니다. SEOUL_API_KEY가 유효한지와 서비스 신청 상태를 확인해 주세요.", 502);
          }
          continue;
        }
        if (code === "ERROR-301") throw new ApiFailure("서울시 따릉이 API 인증에 실패했습니다. SEOUL_API_KEY와 서비스 신청 상태를 확인해 주세요.", 502);
        if (code === "ERROR-337") throw new ApiFailure("서울시 따릉이 API 접근이 허용되지 않았습니다. 호출 IP 또는 서비스 권한을 확인해 주세요.", 502);
        throw new ApiFailure(`서울시 따릉이 API 오류 (${code}): ${result.MESSAGE ?? "자료를 불러오지 못했습니다."}`);
      }
      if (!data) continue;
      stations.push(...asArray(data.row));
    }

    const items = stations.flatMap((station) => {
      const stationLat = Number(station.stationLatitude);
      const stationLng = Number(station.stationLongitude);
      if (!Number.isFinite(stationLat) || !Number.isFinite(stationLng)) return [];
      const distance = lat === null || lng === null ? null : Math.round(distanceMeters(lat, lng, stationLat, stationLng));
      if (distance !== null && distance > radiusParam) return [];
      return [{
        id: station.stationId ?? `${stationLat},${stationLng}`,
        name: station.stationName ?? "이름 없는 대여소",
        latitude: stationLat,
        longitude: stationLng,
        availableBikes: Number(station.parkingBikeTotCnt ?? 0),
        rackCount: Number(station.rackTotCnt ?? 0),
        shared: Number(station.shared ?? 0),
        ...(distance === null ? {} : { distanceMeters: distance }),
      }];
    }).sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));

    return NextResponse.json(
      { items, count: items.length, source: "서울특별시 공공자전거 실시간 대여정보", fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
