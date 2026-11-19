# Safe Bike Seoul

서울 자전거 길찾기 화면과 Next.js API Routes를 포함한 앱입니다.

## 시작하기

1. `.env.example`을 참고해 로컬 `.env` 파일에 API 키를 설정합니다.
2. `npm install`
3. `npm run dev`

`.env` 및 다른 `.env.*` 파일은 Git에서 제외됩니다. 배포 환경에서는 호스팅 서비스의 서버 환경변수 설정에 같은 키를 넣어 주세요. `SEOUL_API_KEY`, `DATA_GO_KR_API_KEY`, `KAKAO_REST_API_KEY`는 서버 전용이며, 이름 앞에 `NEXT_PUBLIC_`을 붙이지 마세요. 브라우저에 표시할 카카오맵 SDK에는 Kakao JavaScript 키가 필요하므로 `NEXT_PUBLIC_KAKAO_JS_KEY`만 클라이언트에 전달됩니다. Kakao Developers에서 JavaScript 키의 허용 도메인을 제한하세요.

## Vercel 배포

1. GitHub 저장소 `cyejin1026/safe-bike-seoul`을 Vercel에서 Import합니다. 프레임워크는 Next.js로 자동 감지되며 기본 빌드 명령은 `npm run build`입니다.
2. Vercel 프로젝트의 **Settings → Environment Variables**에 아래 값을 등록합니다. 운영 배포에는 Production을 선택하고, Preview/Development 배포에서도 API를 사용할 경우 해당 환경도 선택합니다.

| 변수 | 용도 | 공개 범위 |
| --- | --- | --- |
| `SEOUL_API_KEY` | 서울 열린데이터광장 따릉이 API | 서버 전용 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 사고·기상 API | 서버 전용 |
| `KAKAO_REST_API_KEY` | Kakao 장소 검색·자전거 경로 API | 서버 전용 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | Kakao Maps JavaScript SDK | 브라우저에 노출됨. 도메인 제한 필수 |

3. Kakao Developers 앱의 **플랫폼 키 → JavaScript 키 → JavaScript SDK 도메인**에 실제 배포 주소를 등록합니다. 예: `https://safe-bike-seoul.vercel.app`과 연결한 커스텀 도메인 `https://bike.example.com`. 로컬 개발에는 `http://localhost:3000`도 등록합니다. 주소의 경로(`/...`)는 넣지 않습니다.
4. Vercel 첫 배포 후 실제 할당된 `*.vercel.app` 주소를 Kakao JavaScript SDK 도메인에 추가합니다. Preview 배포에서 지도를 확인하려면 그 Preview 주소도 등록해야 합니다.
5. 환경변수를 추가하거나 바꾸면 새 배포부터 적용됩니다. Vercel에서 재배포한 뒤 지도와 API 응답을 확인합니다.

GitHub에는 `.env`의 값을 올리지 않습니다. `.env.example`에는 변수명과 플레이스홀더만 두며, 실제 키는 Vercel 환경변수 화면에서 입력합니다.

## API Routes

모든 외부 API 인증 요청은 Next.js 서버에서 수행합니다. 라우트는 키를 응답에 포함하지 않고, 화면에서 사용할 필드만 정규화해 반환합니다.

| Route | Description |
| --- | --- |
| `GET /api/bike-stations?lat=37.5665&lng=126.9780&radius=3000` | 서울시 따릉이 실시간 대여소 정보. 좌표와 반경은 선택 사항입니다. |
| `GET /api/accidents` | 서울시 자전거 사고다발지역. `year`를 생략하면 데이터가 있는 가장 최근 기준연도를 찾고, `district`는 `jongno`, `jung`, `mapo` 등 자치구 코드 키로 필터링할 수 있습니다. |
| `GET /api/places?query=광화문광장` | Kakao Local 키워드 장소 검색. `x`, `y`, `radius`, `page`, `size`도 선택적으로 전달할 수 있습니다. |
| `GET /api/weather?lat=37.5716&lng=126.9769` | 출발지 좌표를 기상청 단기예보 격자로 변환해 기온·강수확률 및 발표시각·예보시각을 반환합니다. |

서울시 대여소 응답은 최대 3,000개까지 수집해 서버에서 좌표 반경으로 걸러냅니다. 사고다발지역은 한국도로교통공단의 과거 사고 통계이며 실시간 위험정보가 아닙니다. 경로 주변 사고다발지역 표시는 경로와 사고지역 중심점 간 거리가 500m 이내인 항목을 기준으로 합니다.
