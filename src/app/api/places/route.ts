import { NextResponse } from "next/server";
import { ApiFailure, errorResponse, providerJson, serverKey, validCoordinate } from "@/lib/server/providers";

type KakaoPlace = {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  place_url: string;
  x: string;
  y: string;
  distance: string;
};

type KakaoResponse = {
  meta?: { total_count?: number; pageable_count?: number; is_end?: boolean };
  documents?: KakaoPlace[];
};

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = params.get("query")?.trim() ?? "";
    if (query.length < 2 || query.length > 100) {
      throw new ApiFailure("query는 2~100자여야 합니다.", 400);
    }
    const x = validCoordinate(params.get("x"), -180, 180);
    const y = validCoordinate(params.get("y"), -90, 90);
    if ((params.has("x") && x === null) || (params.has("y") && y === null) || (x === null) !== (y === null)) {
      throw new ApiFailure("x와 y에는 올바른 좌표 쌍을 입력해 주세요.", 400);
    }
    const radius = Number(params.get("radius") ?? "20000");
    if (!Number.isInteger(radius) || radius < 0 || radius > 20_000) {
      throw new ApiFailure("radius는 0~20000 미터 범위여야 합니다.", 400);
    }
    const page = Number(params.get("page") ?? "1");
    const size = Number(params.get("size") ?? "10");
    if (!Number.isInteger(page) || page < 1 || page > 45 || !Number.isInteger(size) || size < 1 || size > 15) {
      throw new ApiFailure("page는 1~45, size는 1~15 범위여야 합니다.", 400);
    }

    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(size));
    if (x !== null && y !== null) {
      url.searchParams.set("x", String(x));
      url.searchParams.set("y", String(y));
      url.searchParams.set("radius", String(radius));
      url.searchParams.set("sort", "distance");
    }
    const response = await providerJson<KakaoResponse>(url, {
      headers: { Authorization: `KakaoAK ${serverKey("KAKAO_REST_API_KEY")}` },
      revalidate: 300,
    });
    const items = (response.documents ?? []).map((place) => ({
      id: place.id,
      name: place.place_name,
      category: place.category_name,
      address: place.address_name,
      roadAddress: place.road_address_name,
      phone: place.phone,
      url: place.place_url,
      longitude: Number(place.x),
      latitude: Number(place.y),
      distanceMeters: place.distance ? Number(place.distance) : null,
    }));

    return NextResponse.json(
      { items, count: items.length, totalCount: response.meta?.total_count ?? items.length, isEnd: response.meta?.is_end ?? true },
      { headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

