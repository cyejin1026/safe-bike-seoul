import { NextResponse } from "next/server";
import { ApiFailure, asArray, errorResponse, providerJson, serverKey } from "@/lib/server/providers";

type AccidentRow = {
  afos_id?: string;
  afos_fid?: string | number;
  spot_cd?: string;
  sido_sgg_nm?: string;
  spot_nm?: string;
  occrrnc_cnt?: string | number;
  caslt_cnt?: string | number;
  dth_dnv_cnt?: string | number;
  se_dnv_cnt?: string | number;
  sl_dnv_cnt?: string | number;
  wnd_dnv_cnt?: string | number;
  lo_crd?: string | number;
  la_crd?: string | number;
  geom_json?: string;
};

type AccidentResponse = {
  resultCode?: string;
  resultMsg?: string;
  totalCount?: number;
  items?: { item?: AccidentRow | AccidentRow[] };
};

const districts: Record<string, string> = {
  jongno: "110", jung: "140", yongsan: "170", seongdong: "200", gwangjin: "215",
  dongdaemun: "230", jungnang: "260", seongbuk: "290", gangbuk: "305", dobong: "320",
  nowon: "350", eunpyeong: "380", seodaemun: "410", mapo: "440", yangcheon: "470",
  gangseo: "500", guro: "530", geumcheon: "545", yeongdeungpo: "560", dongjak: "590",
  gwanak: "620", seocho: "650", gangnam: "680", songpa: "710", gangdong: "740",
};

async function fetchYear(year: number, guGun: string) {
  const url = new URL("https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle");
  url.search = new URLSearchParams({
    ServiceKey: serverKey("DATA_GO_KR_API_KEY"),
    searchYearCd: String(year),
    siDo: "11",
    guGun,
    type: "json",
    pageNo: "1",
    numOfRows: "1000",
  }).toString();
  const response = await providerJson<AccidentResponse>(url, { revalidate: 3600 });
  if (response.resultCode === "03") return { rows: [] as AccidentRow[], totalCount: 0 };
  if (response.resultCode !== "00") {
    if (["20", "30", "31", "32", "33"].includes(response.resultCode ?? "")) {
      throw new ApiFailure("사고정보 API 인증 또는 접근 권한을 확인해 주세요 (공공데이터포털 서비스 키/IP 설정).", 502);
    }
    throw new ApiFailure(`한국도로교통공단 API 응답 오류 (${response.resultCode ?? "코드 없음"}).`);
  }
  return {
    rows: asArray(response.items?.item),
    totalCount: Number(response.totalCount ?? 0),
  };
}

function polygonFromJson(value?: string) {
  if (!value) return null;
  try {
    const polygon = JSON.parse(value) as { type?: string; coordinates?: number[][][] };
    if (polygon.type !== "Polygon" || !Array.isArray(polygon.coordinates?.[0])) return null;
    const ring = polygon.coordinates[0].filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    return ring.length >= 4 ? ring : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const yearParam = params.get("year");
    const currentYear = new Date().getFullYear();
    if (yearParam && (!/^\d{4}$/.test(yearParam) || Number(yearParam) < 2015 || Number(yearParam) > currentYear)) {
      throw new ApiFailure("year는 2015년부터 현재 연도까지 입력할 수 있습니다.", 400);
    }
    const district = params.get("district") ?? "all";
    const guGun = district === "all" ? "" : districts[district];
    if (guGun === undefined) throw new ApiFailure("지원하지 않는 서울 자치구입니다.", 400);

    let year = yearParam ? Number(yearParam) : currentYear;
    let result = await fetchYear(year, guGun);
    if (!yearParam) {
      while (result.totalCount === 0 && year > 2015) {
        year -= 1;
        result = await fetchYear(year, guGun);
      }
    }

    const items = result.rows.map((row) => ({
      // afos_id may identify the dataset/year rather than an individual zone.
      // Include the zone's coordinates so each map marker and React key is unique.
      id: `${row.afos_fid ?? row.afos_id ?? row.spot_cd ?? "spot"}-${row.lo_crd},${row.la_crd}`,
      name: row.spot_nm ?? "자전거 사고 다발지역",
      district: row.sido_sgg_nm ?? "",
      longitude: Number(row.lo_crd),
      latitude: Number(row.la_crd),
      accidents: Number(row.occrrnc_cnt ?? 0),
      casualties: Number(row.caslt_cnt ?? 0),
      fatalities: Number(row.dth_dnv_cnt ?? 0),
      polygon: polygonFromJson(row.geom_json),
    })).filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude));

    return NextResponse.json(
      {
        items,
        count: items.length,
        totalCount: result.totalCount,
        year,
        latestYear: year,
        district,
        source: "한국도로교통공단 자전거 교통사고 다발지역",
        historical: true,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, max-age=1800, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
