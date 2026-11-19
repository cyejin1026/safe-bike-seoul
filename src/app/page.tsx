"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Spot = { id: string; name: string; lat: number; lng: number; bikes: number; docks: number; distanceMeters: number };
type PlaceResult = { id: string; name: string; address?: string; latitude?: number; longitude?: number; isDemo?: boolean };
type RouteMode = "BIKE_ONLY" | "SHORTEST";
type BikeRoute = { mode: RouteMode; distanceMeters: number; durationSeconds: number; points: [number, number][]; landingUrl: string | null; fetchedAt?: string; source?: string };
type AccidentSpot = { id: string; name: string; district: string; longitude: number; latitude: number; accidents: number; casualties: number; fatalities: number; polygon: [number, number][] | null };
type WeatherForecast = { temperatureCelsius: number; precipitationProbability: number; grid: { nx: number; ny: number }; announcement: { date: string; time: string }; forecast: { date: string; time: string }; fetchedAt?: string; source?: string };

function formatKstTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

const demoPlaces = ["서울시청", "광화문광장", "경복궁", "서울역", "한강공원"];
function fallbackStationPosition(station: Spot) {
  const left = Math.max(4, Math.min(96, 49 + (station.lng - 126.978) * 1500));
  const top = Math.max(8, Math.min(90, 46 - (station.lat - 37.571) * 1150));
  return { left: `${left}%`, top: `${top}%` };
}

function fallbackRoutePath(points: [number, number][]) {
  return points.map(([lng, lat], index) => {
    const x = ((Math.max(4, Math.min(96, 49 + (lng - 126.978) * 1500))) / 100) * 1200;
    const y = ((Math.max(8, Math.min(90, 46 - (lat - 37.571) * 1150))) / 100) * 850;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function distanceToRouteMeters(longitude: number, latitude: number, points: [number, number][]) {
  const cosLat = Math.cos(latitude * Math.PI / 180);
  const x = (lng: number) => (lng - longitude) * 111_320 * cosLat;
  const y = (lat: number) => (lat - latitude) * 111_320;
  if (points.length < 2) return points.length ? Math.hypot(x(points[0][0]), y(points[0][1])) : Infinity;
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = [x(points[index - 1][0]), y(points[index - 1][1])];
    const [bx, by] = [x(points[index][0]), y(points[index][1])];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

function fallbackMapPosition(longitude: number, latitude: number) {
  const left = Math.max(4, Math.min(96, 49 + (longitude - 126.978) * 1500));
  const top = Math.max(8, Math.min(90, 46 - (latitude - 37.571) * 1150));
  return { left: `${left}%`, top: `${top}%` };
}

declare global {
  interface Window { kakao?: { maps: any } }
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    bike: <><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="m15 6 3.5 0M9 17.5l4-8 3 8h-6l-3-6H4"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    locate: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <path d="M5 12h14"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    wind: <><path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h7a3 3 0 1 1-3 3"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    cloud: <><path d="M20 16.2a4.3 4.3 0 0 0-1.6-8.3 6.2 6.2 0 0 0-12 1.8 3.8 3.8 0 0 0 .6 7.5H19"/></>,
    alert: <><path d="M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export default function Home() {
  const mapNode = useRef<HTMLDivElement>(null);
  const kakaoMap = useRef<any>(null);
  const stationOverlays = useRef<any[]>([]);
  const routeOverlays = useRef<any[]>([]);
  const accidentOverlays = useRef<any[]>([]);
  const [sdkReady, setSdkReady] = useState(false);
  const [from, setFrom] = useState("광화문광장");
  const [to, setTo] = useState("서울시청");
  const [fromCoords, setFromCoords] = useState<{ latitude: number; longitude: number } | null>({ latitude: 37.5716, longitude: 126.9769 });
  const [toCoords, setToCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [activeInput, setActiveInput] = useState<"from" | "to" | null>(null);
  const [placeSearch, setPlaceSearch] = useState<{ query: string; items: PlaceResult[] }>({ query: "", items: [] });
  const [stations, setStations] = useState<Spot[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationsError, setStationsError] = useState("");
  const [stationsFetchedAt, setStationsFetchedAt] = useState("");
  const [routeShown, setRouteShown] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routes, setRoutes] = useState<Partial<Record<RouteMode, BikeRoute>>>({});
  const [routeErrors, setRouteErrors] = useState<Partial<Record<RouteMode, string>>>({});
  const [activeRouteMode, setActiveRouteMode] = useState<RouteMode>("BIKE_ONLY");
  const [stationsShown, setStationsShown] = useState(true);
  const [accidentsShown, setAccidentsShown] = useState(true);
  const [accidents, setAccidents] = useState<AccidentSpot[]>([]);
  const [accidentYear, setAccidentYear] = useState<number | null>(null);
  const [accidentsFetchedAt, setAccidentsFetchedAt] = useState("");
  const [accidentsLoading, setAccidentsLoading] = useState(true);
  const [accidentsError, setAccidentsError] = useState("");
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState("");
  const [weatherFetchedAt, setWeatherFetchedAt] = useState("");
  const [selected, setSelected] = useState<Spot | null>(null);
  const [toast, setToast] = useState("");

  const activeQuery = (activeInput === "from" ? from : to).trim();
  const fallbackPlaces: PlaceResult[] = demoPlaces.filter((place) => place.includes(activeQuery) || activeQuery.length < 2).slice(0, 4)
    .map((name, index) => ({ id: `demo-${index}`, name, isDemo: true }));
  const visiblePlaces = activeQuery.length < 2
    ? fallbackPlaces
    : placeSearch.query === activeQuery ? placeSearch.items : [];
  const activeRoute = routes[activeRouteMode];
  const nearRouteAccidents = useMemo(() => {
    if (!activeRoute) return [];
    return accidents.map((spot) => ({ ...spot, routeDistanceMeters: distanceToRouteMeters(spot.longitude, spot.latitude, activeRoute.points) }))
      .filter((spot) => spot.routeDistanceMeters <= 500)
      .sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);
  }, [accidents, activeRoute]);
  const nearRouteAccidentIds = useMemo(() => new Set(nearRouteAccidents.map((spot) => spot.id)), [nearRouteAccidents]);
  const routeComparisons = useMemo(() => {
    const result: Partial<Record<RouteMode, number>> = {};
    (['BIKE_ONLY', 'SHORTEST'] as const).forEach((mode) => {
      const route = routes[mode];
      if (route) result[mode] = accidents.filter((spot) => distanceToRouteMeters(spot.longitude, spot.latitude, route.points) <= 500).length;
    });
    return result;
  }, [accidents, routes]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    if (!activeInput || activeQuery.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/places?query=${encodeURIComponent(activeQuery)}&size=6`, { signal: controller.signal });
        if (!response.ok) throw new Error("Place search failed");
        const payload = await response.json() as { items: PlaceResult[] };
        setPlaceSearch({ query: activeQuery, items: payload.items });
      } catch {
        if (!controller.signal.aborted) {
          setPlaceSearch({
            query: activeQuery,
            items: demoPlaces.filter((place) => place.includes(activeQuery)).slice(0, 4)
              .map((name, index) => ({ id: `demo-${index}`, name, isDemo: true })),
          });
        }
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeInput, activeQuery]);

  const initializeMap = useCallback(() => {
    if (!window.kakao?.maps || !mapNode.current || kakaoMap.current) return;
    const { kakao } = window;
    const center = new kakao.maps.LatLng(37.571, 126.978);
    const map = new kakao.maps.Map(mapNode.current, { center, level: 5 });
    kakaoMap.current = map;

    setSdkReady(true);
  }, []);

  const updateStationOverlays = useCallback(() => {
    if (!kakaoMap.current || !window.kakao?.maps) return;
    stationOverlays.current.forEach((overlay) => overlay.setMap(null));
    stationOverlays.current = stations.map((station, index) => {
      const content = document.createElement("button");
      content.className = "sdk-station-marker";
      content.type = "button";
      content.innerHTML = `<span class="marker-bicycle">🚲</span><span>${station.bikes}</span>`;
      content.setAttribute("aria-label", `${station.name}, 이용 가능한 자전거 ${station.bikes}대`);
      content.onclick = () => selectStation(station);
      const overlay = new window.kakao!.maps.CustomOverlay({
        position: new window.kakao!.maps.LatLng(station.lat, station.lng),
        content,
        yAnchor: 1.2,
        zIndex: index === 0 ? 5 : 2,
      });
      overlay.setMap(stationsShown ? kakaoMap.current : null);
      return overlay;
    });
  }, [stations, stationsShown]);

  const updateRouteOverlays = useCallback(() => {
    if (!kakaoMap.current || !window.kakao?.maps) return;
    routeOverlays.current.forEach((overlay) => overlay.setMap(null));
    const bounds = new window.kakao.maps.LatLngBounds();
    let hasRoute = false;
    routeOverlays.current = (["BIKE_ONLY", "SHORTEST"] as const).flatMap((mode) => {
      const route = routes[mode];
      if (!route || route.points.length < 2) return [];
      const path = route.points.map(([lng, lat]) => new window.kakao!.maps.LatLng(lat, lng));
      path.forEach((point: any) => bounds.extend(point));
      hasRoute = true;
      const polyline = new window.kakao!.maps.Polyline({
        path,
        strokeWeight: activeRouteMode === mode ? 8 : 5,
        strokeColor: mode === "BIKE_ONLY" ? "#16845c" : "#5681bd",
        strokeOpacity: activeRouteMode === mode ? 0.95 : 0.72,
        strokeStyle: "solid",
        zIndex: activeRouteMode === mode ? 3 : 2,
      });
      polyline.setMap(routeShown ? kakaoMap.current : null);
      return [polyline];
    });
    if (hasRoute && routeShown) kakaoMap.current.setBounds(bounds);
  }, [activeRouteMode, routeShown, routes]);

  const updateAccidentOverlays = useCallback(() => {
    if (!kakaoMap.current || !window.kakao?.maps) return;
    accidentOverlays.current.forEach((overlay) => overlay.setMap(null));
    accidentOverlays.current = [];
    if (!accidentsShown) return;
    accidents.forEach((spot) => {
      const nearRoute = nearRouteAccidentIds.has(spot.id);
      const position = new window.kakao!.maps.LatLng(spot.latitude, spot.longitude);
      if (spot.polygon?.length) {
        const polygon = new window.kakao!.maps.Polygon({
          path: spot.polygon.map(([lng, lat]) => new window.kakao!.maps.LatLng(lat, lng)),
          strokeWeight: nearRoute ? 3 : 2,
          strokeColor: nearRoute ? "#d65e3f" : "#e58b69",
          strokeOpacity: 0.9,
          fillColor: nearRoute ? "#ee8b68" : "#efb09a",
          fillOpacity: nearRoute ? 0.28 : 0.16,
          zIndex: nearRoute ? 4 : 2,
        });
        polygon.setMap(kakaoMap.current);
        accidentOverlays.current.push(polygon);
      }
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `sdk-accident-marker ${nearRoute ? "near-route" : ""}`;
      marker.textContent = String(spot.accidents);
      marker.title = `${spot.name} · ${accidentYear ?? "과거"}년 사고 ${spot.accidents}건`;
      marker.setAttribute("aria-label", `${spot.name}, ${accidentYear ?? "과거"}년 자전거 사고 ${spot.accidents}건${nearRoute ? ", 사고지역 중심이 경로 500미터 이내" : ""}`);
      marker.onclick = () => showToast(`${spot.name} · ${accidentYear ?? "과거"}년 사고 ${spot.accidents}건 · 과거 사고정보`);
      const overlay = new window.kakao!.maps.CustomOverlay({ position, content: marker, yAnchor: 0.5, zIndex: nearRoute ? 8 : 6 });
      overlay.setMap(kakaoMap.current);
      accidentOverlays.current.push(overlay);
    });
  }, [accidentYear, accidents, accidentsShown, nearRouteAccidentIds, showToast]);

  useEffect(() => {
    if (sdkReady) updateStationOverlays();
  }, [sdkReady, updateStationOverlays]);

  useEffect(() => {
    if (sdkReady) updateRouteOverlays();
  }, [sdkReady, updateRouteOverlays]);

  useEffect(() => {
    if (sdkReady) updateAccidentOverlays();
  }, [sdkReady, updateAccidentOverlays]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/accidents", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "사고다발지역 정보를 불러오지 못했습니다.");
        return payload as { items: AccidentSpot[]; year: number; fetchedAt?: string };
      })
      .then((payload) => {
        setAccidents(payload.items);
        setAccidentYear(payload.year);
        setAccidentsFetchedAt(payload.fetchedAt ?? "");
        setAccidentsError(payload.items.length ? "" : `${payload.year}년 서울 사고다발지역 자료가 없습니다.`);
        setAccidentsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAccidents([]);
        setAccidentsError(error instanceof Error ? error.message : "사고다발지역 정보를 불러오지 못했습니다.");
        setAccidentsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!fromCoords) return;
    const controller = new AbortController();
    const loadWeather = async () => {
      try {
        const params = new URLSearchParams({ lat: String(fromCoords.latitude), lng: String(fromCoords.longitude) });
        const response = await fetch(`/api/weather?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "기상청 예보를 불러오지 못했습니다.");
        const forecast = payload as WeatherForecast;
        setWeather(forecast);
        setWeatherFetchedAt(forecast.fetchedAt ?? "");
        setWeatherError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setWeather(null);
        setWeatherFetchedAt("");
        setWeatherError(error instanceof Error ? error.message : "기상청 예보를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setWeatherLoading(false);
      }
    };
    void loadWeather();
    const refresh = window.setInterval(() => void loadWeather(), 15 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(refresh); };
  }, [fromCoords]);

  useEffect(() => {
    if (!fromCoords) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ lat: String(fromCoords.latitude), lng: String(fromCoords.longitude), radius: "5000" });
    fetch(`/api/bike-stations?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "대여소 정보를 불러오지 못했습니다.");
        return payload as { items: Array<{ id: string; name: string; latitude: number; longitude: number; availableBikes: number; rackCount: number; distanceMeters?: number }>; fetchedAt?: string };
      })
      .then((payload) => {
        setStationsFetchedAt(payload.fetchedAt ?? "");
        setStations(payload.items.map((station) => ({
          id: station.id,
          name: station.name,
          lat: station.latitude,
          lng: station.longitude,
          bikes: station.availableBikes,
          docks: station.rackCount,
          distanceMeters: station.distanceMeters ?? 0,
        })));
        setStationsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStations([]);
        setStationsError(error instanceof Error ? error.message : "대여소 정보를 불러오지 못했습니다.");
        setStationsLoading(false);
      });
    return () => controller.abort();
  }, [fromCoords]);

  useEffect(() => {
    if (!kakaoMap.current || !fromCoords || !window.kakao?.maps) return;
    kakaoMap.current.panTo(new window.kakao.maps.LatLng(fromCoords.latitude, fromCoords.longitude));
  }, [fromCoords, sdkReady]);

  function choosePlace(place: PlaceResult) {
    const coords = place.latitude !== undefined && place.longitude !== undefined
      ? { latitude: place.latitude, longitude: place.longitude }
      : null;
    if (activeInput === "from") {
      setFrom(place.name);
      setFromCoords(coords);
      setWeather(null);
      setWeatherLoading(Boolean(coords));
      setWeatherError(coords ? "" : "출발지 위치를 선택해 주세요.");
      setStations([]);
      setSelected(null);
      setRoutes({});
      setRouteErrors({});
      setStationsLoading(Boolean(coords));
      setStationsError(coords ? "" : "출발지를 검색해 위치를 선택해 주세요.");
    }
    if (activeInput === "to") {
      setTo(place.name);
      setToCoords(coords);
      setRoutes({});
      setRouteErrors({});
    }
    setActiveInput(null);
    if (kakaoMap.current && window.kakao?.maps && coords) {
      kakaoMap.current.panTo(new window.kakao.maps.LatLng(coords.latitude, coords.longitude));
    }
  }

  function selectStation(station: Spot) {
    setSelected(station);
    setFrom(station.name);
    setFromCoords({ latitude: station.lat, longitude: station.lng });
    setWeather(null);
    setWeatherLoading(true);
    setWeatherError("");
    setRoutes({});
    setRouteErrors({});
    if (kakaoMap.current && window.kakao?.maps) {
      kakaoMap.current.panTo(new window.kakao.maps.LatLng(station.lat, station.lng));
    }
  }

  async function requestRoutes() {
    if (!selected) {
      showToast("경로를 찾으려면 지도에서 출발할 따릉이 대여소를 먼저 선택해 주세요.");
      return;
    }
    if (!toCoords) {
      showToast("목적지를 검색한 뒤 검색 결과에서 위치를 선택해 주세요.");
      return;
    }

    setRouteLoading(true);
    setRoutes({});
    setRouteErrors({});
    setRouteShown(true);
    const modes: RouteMode[] = ["BIKE_ONLY", "SHORTEST"];
    const results = await Promise.all(modes.map(async (mode) => {
      const params = new URLSearchParams({
        startLat: String(selected.lat),
        startLng: String(selected.lng),
        endLat: String(toCoords.latitude),
        endLng: String(toCoords.longitude),
        mode,
      });
      try {
        const response = await fetch(`/api/bicycle-route?${params}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "경로를 찾지 못했습니다.");
        return { mode, route: payload as BikeRoute };
      } catch (error) {
        return { mode, error: error instanceof Error ? error.message : "경로를 찾지 못했습니다." };
      }
    }));

    const nextRoutes: Partial<Record<RouteMode, BikeRoute>> = {};
    const nextErrors: Partial<Record<RouteMode, string>> = {};
    results.forEach((result) => {
      if ("route" in result) nextRoutes[result.mode] = result.route;
      else nextErrors[result.mode] = result.error;
    });
    setRoutes(nextRoutes);
    setRouteErrors(nextErrors);
    setRouteLoading(false);
    if (nextRoutes.BIKE_ONLY) setActiveRouteMode("BIKE_ONLY");
    else if (nextRoutes.SHORTEST) setActiveRouteMode("SHORTEST");
    else showToast("카카오에서 경로를 반환하지 않았어요. 아래 오류 안내를 확인해 주세요.");
  }

  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

  return (
    <main className="app-shell">
      {key && <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`} strategy="afterInteractive" onLoad={() => window.kakao?.maps.load(initializeMap)} onError={() => showToast("카카오맵 SDK를 불러오지 못했어요. 예시 지도를 표시합니다.")} />}
      <aside className="side-panel">
        <header className="brand-row">
          <div className="brand-mark"><Icon name="bike" size={23}/></div>
          <div><div className="brand-name">safe<span>bike</span></div><div className="brand-location">SEOUL · SAFE RIDE</div></div>
          <button className="profile-button" aria-label="프로필">윤</button>
        </header>

        <section className="welcome"><div className="eyebrow">SEOUL CYCLING GUIDE <span>● LIVE</span></div><h1>오늘은 어디로<br/><em>달려볼까요?</em></h1><p>따릉이·경로·과거 사고·날씨 정보를 함께 살펴봐요.</p></section>

        <section className="route-form" aria-label="경로 검색">
          <div className="route-rail"><span className="rail-dot start-dot"/><span className="rail-line"/><span className="rail-dot end-dot"/></div>
          <div className="route-fields">
            <div className="route-input-wrap"><label htmlFor="from">출발지</label><div className="route-input-row"><input id="from" value={from} onFocus={() => setActiveInput("from")} onChange={(e) => { setFrom(e.target.value); setFromCoords(null); setWeather(null); setWeatherLoading(false); setWeatherError("출발지 위치를 선택해 주세요."); setStations([]); setStationsError("출발지를 검색해 위치를 선택해 주세요."); setStationsLoading(false); setSelected(null); setRoutes({}); setRouteErrors({}); }} placeholder="출발지를 검색해 주세요"/><button aria-label="출발지 검색" onClick={() => setActiveInput("from")}><Icon name="search" size={18}/></button></div></div>
            <button className="swap-button" aria-label="출발지와 목적지 바꾸기" onClick={() => { setFrom(to); setTo(from); setFromCoords(toCoords); setToCoords(fromCoords); setWeather(null); setWeatherLoading(Boolean(toCoords)); setWeatherError(toCoords ? "" : "출발지 위치를 선택해 주세요."); setStations([]); setSelected(null); setRoutes({}); setRouteErrors({}); setStationsLoading(Boolean(toCoords)); setStationsError(toCoords ? "" : "출발지를 검색해 위치를 선택해 주세요."); }}><span>↕</span></button>
            <div className="route-input-wrap"><label htmlFor="to">도착지</label><div className="route-input-row"><input id="to" value={to} onFocus={() => setActiveInput("to")} onChange={(e) => { setTo(e.target.value); setToCoords(null); setRoutes({}); setRouteErrors({}); }} placeholder="목적지를 검색해 주세요"/><button aria-label="목적지 검색" onClick={() => setActiveInput("to")}><Icon name="search" size={18}/></button></div></div>
            {activeInput && <div className="suggestions">{visiblePlaces.length ? visiblePlaces.map((place) => <button key={place.id} onMouseDown={(e) => e.preventDefault()} onClick={() => choosePlace(place)}><Icon name="pin" size={16}/><span className="suggestion-copy">{place.name}{place.address && <small>{place.address}</small>}</span><span>{place.isDemo ? "예시" : "장소"}</span></button>) : activeQuery.length < 2 ? <p>두 글자 이상 입력하면 장소를 검색해요.</p> : placeSearch.query === activeQuery ? <p>검색 결과가 없어요. 예시 장소를 입력해 보세요.</p> : <p>카카오 장소 검색 중…</p>}</div>}
          </div>
          <button className="find-route" onClick={() => { setActiveInput(null); void requestRoutes(); }} disabled={routeLoading}><Icon name="bike" size={19}/>{routeLoading ? "카카오 경로 조회 중…" : "선택한 대여소에서 경로 찾기"}<Icon name="arrow" size={18}/></button>
          {(routeLoading || Object.keys(routes).length > 0 || Object.keys(routeErrors).length > 0) && <div className="route-options" aria-live="polite"><div className="route-options-heading">카카오 자전거 경로 비교</div>{(["BIKE_ONLY", "SHORTEST"] as const).map((mode) => { const route = routes[mode]; const error = routeErrors[mode]; return <button key={mode} className={`route-option ${activeRouteMode === mode && route ? "selected" : ""} ${error ? "failed" : ""}`} disabled={!route} onClick={() => setActiveRouteMode(mode)}><span className={`route-option-dot ${mode === "BIKE_ONLY" ? "green" : "blue"}`}/><span className="route-option-copy"><strong>{mode === "BIKE_ONLY" ? "자전거도로 우선" : "최단 경로"}</strong><small>{error ?? (route ? `${(route.distanceMeters / 1000).toFixed(1)}km · 약 ${Math.max(1, Math.round(route.durationSeconds / 60))}분` : routeLoading ? "조회 중…" : "경로를 찾지 못했습니다." )}</small>{route && <small className="route-accident-count">경로 중심 기준 500m 이내 과거 사고다발지역 {routeComparisons[mode] ?? 0}곳</small>}</span>{route && <Icon name="chevron" size={15}/>}</button>; })}</div>}
        </section>

        <div className="section-heading"><h2>주변 정보</h2><span className="text-button">출발지 기준</span></div>
        <section className="layer-list" aria-label="지도 정보 필터">
          <button className={`layer-item ${stationsShown ? "is-on" : ""}`} onClick={() => setStationsShown(!stationsShown)}><span className="layer-icon mint"><Icon name="bike" size={18}/></span><span className="layer-copy"><strong>따릉이 대여소</strong><small>{stationsLoading ? "실시간 대여소 조회 중…" : `주변 ${stations.length}곳 · 이용 가능 ${stations.reduce((total, station) => total + station.bikes, 0)}대`}</small></span><span className={`toggle ${stationsShown ? "checked" : ""}`}/></button>
          <button className={`layer-item ${routeShown ? "is-on" : ""}`} onClick={() => setRouteShown(!routeShown)}><span className="layer-icon blue"><Icon name="arrow" size={18}/></span><span className="layer-copy"><strong>카카오 자전거 경로</strong><small>자전거도로 우선 · 최단 경로</small></span><span className={`toggle ${routeShown ? "checked" : ""}`}/></button>
          <button className={`layer-item ${accidentsShown ? "is-on" : ""}`} onClick={() => setAccidentsShown(!accidentsShown)}><span className="layer-icon coral"><Icon name="alert" size={18}/></span><span className="layer-copy"><strong>자전거 사고다발지역</strong><small>{accidentsLoading ? "공단 자료 조회 중…" : accidentsError || `${accidentYear}년 기준 · ${accidents.length}곳`}</small></span><span className={`toggle ${accidentsShown ? "checked" : ""}`}/></button>
        </section>

        <div className="accident-history-note"><Icon name="alert" size={14}/><span>{accidentYear ? `${accidentYear}년 사고 통계 · 과거 사고정보이며 현재 위험도를 나타내지 않습니다.` : "사고 통계는 과거 기록이며 현재 위험도를 나타내지 않습니다."}</span></div>
        <section className="accident-nearby" aria-label="경로 주변 사고다발지역">
          <div className="nearby-heading"><strong>경로 주변 사고다발지역</strong><span>{activeRoute ? `중심 기준 500m 이내 ${nearRouteAccidents.length}곳` : "경로 조회 후 표시"}</span></div>
          {!activeRoute ? <p className="nearby-message">따릉이 대여소와 목적지를 선택하고 경로를 조회해 주세요.</p> : nearRouteAccidents.length === 0 ? <p className="nearby-message">경로 500m 이내에 해당 연도 사고다발지역이 없습니다.</p> : nearRouteAccidents.slice(0, 3).map((spot) => <button className="accident-nearby-row" key={spot.id} onClick={() => showToast(`${spot.name} · ${accidentYear}년 사고 ${spot.accidents}건 · 과거 사고정보`)}><span className="accident-nearby-icon"><Icon name="alert" size={14}/></span><span>{spot.name}<small>{Math.round(spot.routeDistanceMeters)}m · 사고 {spot.accidents}건 · 사상자 {spot.casualties}명</small></span></button>)}
        </section>

        <section className="nearby-stations" aria-label="출발지 주변 대여소">
          <div className="nearby-heading"><strong>출발지 주변 대여소</strong><span>{stationsLoading ? "조회 중" : `${stations.length}곳`}</span></div>
          {stationsLoading ? <p className="nearby-message">서울시 대여소 정보를 불러오고 있어요.</p> : stationsError ? <p className="nearby-message">{stationsError}</p> : stations.length === 0 ? <p className="nearby-message">5km 안에 대여소가 없습니다.</p> : stations.slice(0, 4).map((station) => <button className="nearby-row" key={station.id} onClick={() => selectStation(station)}><span className="nearby-bike"><Icon name="bike" size={14}/></span><span className="nearby-name">{station.name}<small>{station.distanceMeters >= 1000 ? `${(station.distanceMeters / 1000).toFixed(1)}km` : `${station.distanceMeters}m`}</small></span><span className="nearby-count">{station.bikes}<small>대</small></span></button>)}
        </section>

        <section className="weather-card" aria-label="출발지 기상청 단기예보">
          <div className="weather-top"><div><div className="weather-caption">출발지 단기예보 <span>{weatherLoading ? "조회 중" : weather ? "기상청" : "확인 필요"}</span></div><div className="weather-temp">{weather ? weather.temperatureCelsius : weatherLoading ? "…" : "—"}<span>°</span><small>기온</small></div></div><div className="sun-illustration weather-cloud"><Icon name="cloud" size={36}/><i/></div></div>
          <div className="weather-bottom"><span>강수확률 <b className="weather-pop">{weather ? `${weather.precipitationProbability}%` : "—"}</b></span><span className="weather-divider"/><span>격자 <b>{weather ? `${weather.grid.nx}, ${weather.grid.ny}` : "—"}</b></span></div>
          {weather ? <><div className="weather-times"><div><span>발표시각</span><strong>{weather.announcement.date.slice(4, 6)}/{weather.announcement.date.slice(6, 8)} {weather.announcement.time.slice(0, 2)}:{weather.announcement.time.slice(2, 4)}</strong></div><div><span>예보시각</span><strong>{weather.forecast.date.slice(4, 6)}/{weather.forecast.date.slice(6, 8)} {weather.forecast.time.slice(0, 2)}:{weather.forecast.time.slice(2, 4)}</strong></div></div><div className="weather-source">기상청 단기예보 · 조회 {formatKstTime(weatherFetchedAt)}</div></> : <div className="weather-advice">{weatherError || "출발지 좌표 기준 예보를 불러오고 있어요."}</div>}
        </section>

        <section className="data-provenance" aria-label="정보 출처 및 갱신 시각"><strong>정보 출처 · 갱신 시각</strong><div><span>따릉이</span><small>서울시 실시간 대여정보 · {formatKstTime(stationsFetchedAt)}</small></div><div><span>경로</span><small>카카오 자전거 경로 · {formatKstTime(activeRoute?.fetchedAt)}</small></div><div><span>사고</span><small>도로교통공단 · {accidentYear ?? "—"}년 기록 · 조회 {formatKstTime(accidentsFetchedAt)}</small></div><p>경로별 거리와 사고다발지역 개수는 참고용 집계입니다. 실제 안전성이나 현재 위험도를 보장하지 않습니다.</p></section>

        <footer className="side-footer"><span className="data-label"><i/> 대여소 실시간 · 사고는 {accidentYear ?? "과거"}년 기록 · 날씨 기상청 예보</span><span>Safe Bike Seoul</span></footer>
      </aside>

      <section className="map-panel" aria-label="서울 자전거 지도">
        <div className="map-topbar"><div className="breadcrumb"><span>서울</span><Icon name="chevron" size={14}/><strong>종로구</strong><span className="map-live"><i/> {stationsLoading ? "대여소 조회 중" : "서울시 대여소 실시간"}</span></div><div className="map-top-actions"><button className="map-action" onClick={() => showToast("현재 위치는 출발지로 설정해 주세요.")}><Icon name="locate" size={17}/><span>내 위치</span></button><button className="map-action" onClick={() => showToast("지도 설정을 열었어요.")}><Icon name="layers" size={17}/><span>지도 설정</span></button></div></div>

        <div className={`map-canvas ${sdkReady ? "kakao-active" : ""}`}>
          <div ref={mapNode} id="kakao-map" className="kakao-map" aria-label="카카오맵"/>
          {!sdkReady && <div className="map-fallback-note" role="status">카카오맵 SDK 미연결 · 예시 배경지도라 위치와 경로가 실제 지도와 다를 수 있습니다.</div>}
          {!sdkReady && <div className="map-fallback" aria-label="예시 서울 지도">
            <svg className="map-drawing" viewBox="0 0 1200 850" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <path className="river" d="M-40 722 C130 655 220 710 360 680 S610 713 770 670 1020 702 1240 620"/>
              <path className="river-highlight" d="M-40 722 C130 655 220 710 360 680 S610 713 770 670 1020 702 1240 620"/>
              <path className="major-road" d="M80 0 220 850M425 -30 505 880M840 -20 740 900M1110 0 900 850M0 236 1200 290M-30 455 1200 375M0 570 1200 498"/>
              <path className="minor-road" d="M0 100 1200 140M0 180 1200 205M0 340 1200 320M0 520 1200 610M140 0 130 650M315 0 340 750M630 0 600 720M980 0 1030 720M0 650 1200 560"/>
              <path className="bike-lane" d="M125 0 245 850M720 0 655 850M0 397 1200 458"/>
              <path className="park-shape" d="m343 190 95-16 39 54-15 95-85 19-55-68zM838 445l102-37 50 52-20 94-94 31-47-65zM160 430l57-18 31 46-23 72-70-9-20-48z"/>
            </svg>
            <div className="map-label label-gyeongbok">경복궁</div><div className="map-label label-gwang">광화문광장</div><div className="map-label label-city">서울시청</div><div className="map-label label-cheong">청계천</div><div className="map-label label-jongno">종로</div><div className="map-label label-park">세종문화회관</div><div className="map-label label-road">사직로</div><div className="map-label label-district">종로구</div>
            {stationsShown && stations.map((station) => <button className="bike-station-pin" key={station.id} style={fallbackStationPosition(station)} onClick={() => selectStation(station)} aria-label={`${station.name}, 이용 가능한 자전거 ${station.bikes}대`}><Icon name="bike" size={14}/><b>{station.bikes}</b></button>)}
            {routeShown && Object.keys(routes).length > 0 && <svg className="route-overlay" viewBox="0 0 1200 850" preserveAspectRatio="none" aria-label="카카오 자전거 경로">
              {(["BIKE_ONLY", "SHORTEST"] as RouteMode[]).map((mode) => {
                const route = routes[mode];
                return route ? <path key={mode} className={`route-fallback route-${mode.toLowerCase()}`} d={fallbackRoutePath(route.points)}/> : null;
              })}
            </svg>}
            {accidentsShown && accidents.map((spot) => {
              const nearRoute = nearRouteAccidentIds.has(spot.id);
              return <button key={spot.id} className={`accident-pin real-accident-pin ${nearRoute ? "near-route" : ""}`} style={fallbackMapPosition(spot.longitude, spot.latitude)} title={`${spot.name} · ${accidentYear}년 사고 ${spot.accidents}건`} aria-label={`${spot.name}, ${accidentYear}년 사고 ${spot.accidents}건${nearRoute ? ", 사고지역 중심이 경로 500미터 이내" : ""}`} onClick={() => showToast(`${spot.name} · ${accidentYear}년 사고 ${spot.accidents}건 · 과거 사고정보`)}>{spot.accidents}</button>;
            })}
          </div>}

          <div className="map-controls"><button aria-label="확대" onClick={() => kakaoMap.current?.setLevel(Math.max(1, kakaoMap.current.getLevel() - 1))}><Icon name="plus" size={19}/></button><button aria-label="축소" onClick={() => kakaoMap.current?.setLevel(Math.min(12, kakaoMap.current.getLevel() + 1))}><Icon name="minus" size={19}/></button><span/><button aria-label="현재 위치" onClick={() => showToast("현재 위치는 예시 위치로 설정되어 있어요.")}><Icon name="locate" size={18}/></button></div>

          <div className="map-legend"><div className="legend-header"><span>지도 범례</span><Icon name="layers" size={16}/></div><div><i className="legend-bike"/> 따릉이 대여소</div><div><i className="legend-route"/> 자전거 경로</div><div><i className="legend-accident">!</i> 사고 다발 구간</div></div>

          {activeRoute && selected && <div className="route-summary"><div className="summary-icon"><Icon name="bike" size={19}/></div><div className="summary-body"><div className="summary-title">{activeRouteMode === "BIKE_ONLY" ? "자전거도로 우선" : "최단 경로"}</div><div className="summary-dest">{selected.name} <Icon name="arrow" size={13}/> {to}</div></div><div className="summary-stats"><strong>{(activeRoute.distanceMeters / 1000).toFixed(1)} <small>km</small></strong><span><Icon name="clock" size={14}/> 약 {Math.max(1, Math.round(activeRoute.durationSeconds / 60))}분</span></div><button aria-label="카카오 경로 상세 보기" className="summary-chevron" onClick={() => activeRoute.landingUrl ? window.open(activeRoute.landingUrl, "_blank", "noopener,noreferrer") : showToast("카카오 응답에 상세 경로 링크가 없습니다.")}><Icon name="chevron" size={19}/></button></div>}

          {selected && <div className="station-card"><button className="card-close" aria-label="대여소 정보 닫기" onClick={() => setSelected(null)}><Icon name="close" size={16}/></button><div className="station-card-kicker"><span className="station-card-icon"><Icon name="bike" size={16}/></span> 서울시 실시간 대여소 <span className="open-now">조회됨</span></div><strong>{selected.name}</strong><small><Icon name="pin" size={13}/>{selected.distanceMeters >= 1000 ? `${(selected.distanceMeters / 1000).toFixed(1)}km` : `${selected.distanceMeters}m`} · {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</small><div className="station-inventory"><div><span>대여 가능</span><strong>{selected.bikes}<small>대</small></strong></div><i/><div><span>거치 가능</span><strong>{selected.docks}<small>대</small></strong></div></div></div>}

          <div className="map-attribution">{sdkReady ? <>ⓒ Kakao Mobility <span>·</span> <b>대여소: 서울시 실시간 · 경로: 카카오 · 사고: 도로교통공단 {accidentYear ?? "과거"}년 통계</b></> : <b>예시 배경지도 · 실제 지도 좌표가 아닙니다</b>}</div>
        </div>
        <div className="map-bottom-bar"><span><i/> 출발지 기준 반경 5km</span><span>사고는 {accidentYear ?? "과거"}년 기준 자료로 과거 기록이며, 실시간 위험정보가 아닙니다.</span><button onClick={() => showToast("사고다발지역은 한국도로교통공단의 과거 사고 통계입니다. 실시간 위험정보가 아닙니다.")}>사고정보 안내 <Icon name="chevron" size={13}/></button></div>
      </section>
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </main>
  );
}
