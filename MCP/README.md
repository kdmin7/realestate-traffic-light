# 반도체 수출입 조회 MCP Server

공공데이터포털의 **관세청_품목별 국가별 수출입실적** API를 사용하여
특정 국가와 반도체 품목의 **수출금액 · 수입금액 · 무역수지**를 조회하는 간단한 MCP 서버입니다.

- 최신 MCP SDK(`@modelcontextprotocol/sdk`)와 JavaScript(ESM)로 작성
- XML 응답을 `fast-xml-parser`로 JSON 변환
- 숫자처럼 보이는 문자열을 자동으로 숫자 변환하지 않도록 설정하여 `resultCode`의 `"00"`을 안전하게 유지
- 모든 오류 메시지를 한국어로 안내

---

## 사용 API

| 항목 | 내용 |
|------|------|
| 제공처 | 공공데이터포털 (관세청) |
| API | 관세청_품목별 국가별 수출입실적 |
| 엔드포인트 | `http://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList` |
| 응답 형식 | XML (본 서버에서 JSON으로 변환) |

---

## 설치

```bash
npm install
```

의존성:
- `@modelcontextprotocol/sdk`
- `fast-xml-parser`
- `zod`

---

## 환경변수

| 환경변수 | 설명 |
|----------|------|
| `CUSTOMS_API_KEY` | 공공데이터포털에서 발급받은 서비스키(디코딩 키 권장) |

```bash
# macOS / Linux
export CUSTOMS_API_KEY="발급받은_서비스키"

# Windows PowerShell
$env:CUSTOMS_API_KEY = "발급받은_서비스키"
```

---

## 실행

```bash
npm start
# 또는
node trade-server.js
```

이 서버는 **stdio** 트랜스포트로 동작하며, MCP 클라이언트(예: Claude Desktop)에서 연결하여 사용합니다.

### Claude Desktop 등록 예시

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "semiconductor-trade": {
      "command": "node",
      "args": ["C:/Users/User/Desktop/MCP/trade-server.js"],
      "env": {
        "CUSTOMS_API_KEY": "발급받은_서비스키"
      }
    }
  }
}
```

---

## 제공 Tool

### `get_semiconductor_trade`

특정 국가와 반도체 품목의 수출입 실적을 조회합니다.

**입력 파라미터**

| 이름 | 필수 | 설명 | 예시 |
|------|------|------|------|
| `country` | ✅ | 관세청 국가코드 | `US`, `CN`, `JP` |
| `hsCode` | ❌ (기본 `8541`) | 반도체 품목 HS코드 | `8541`(다이오드·트랜지스터), `8542`(집적회로) |
| `startYearMonth` | ✅ | 조회 시작 연월 (YYYYMM) | `202401` |
| `endYearMonth` | ✅ | 조회 종료 연월 (YYYYMM) | `202412` |

**반환 항목**

| 항목 | 설명 |
|------|------|
| `기간` | 조회 기간(연도/연월) |
| `국가명` | 상대 국가명 |
| `품목명` | 반도체 품목명(HS코드) |
| `수출금액` | 수출금액 (USD) |
| `수입금액` | 수입금액 (USD) |
| `무역수지` | 무역수지 (USD, 수출 − 수입) |

**응답 예시(요약)**

```
✅ 반도체 수출입 조회 결과 (총 1건)

• [2024] 미국 / 8541
   - 수출금액: 1,234,567 USD
   - 수입금액: 234,567 USD
   - 무역수지: 1,000,000 USD
```

구조화된 JSON도 함께 반환됩니다.

---

## 동작 방식 및 주의사항

1. **정상 응답 판정**: API 응답의 `resultCode`가 문자열 `"00"`인 경우에만 정상으로 처리합니다.
   - `fast-xml-parser`의 `parseTagValue: false` 설정으로 `"00"`이 숫자 `0`으로 변환되지 않도록 하고,
     비교 시 `String(resultCode) !== "00"`으로 문자열 비교를 수행합니다.
2. **오류 처리**: 다음의 경우 한국어 오류 메시지를 반환합니다.
   - `CUSTOMS_API_KEY` 미설정
   - 네트워크/HTTP 오류
   - XML 파싱 실패
   - `resultCode`가 `"00"`이 아닌 경우 (코드/메시지 포함)
3. **조회 결과 없음**: 정상 응답이지만 항목이 없으면 안내 메시지를 반환합니다.

---

## 라이선스

ISC
