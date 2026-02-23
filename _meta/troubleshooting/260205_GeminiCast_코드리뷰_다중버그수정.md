---
type: troubleshooting
status: done
description: "코드 리뷰에서 발견된 8개 버그/성능 이슈 일괄 수정"
created: 2026-02-05
modified: 2026-02-05
phase: fix
---

# 문제
> 코드 리뷰에서 Critical 5개, Bug 5개, Performance 4개 이슈 발견. SessionReport 미렌더링, 메모리 누수, 오디오 손상 등 다수 문제 존재.

---

# 시도
- 8개 이슈를 Task로 생성하여 병렬 추적
- 독립적인 파일(pcm-processor.js, PracticeMode.tsx)은 개별 수정
- App.tsx 관련 6개 이슈는 순차적 수정

---

# 원인
1. **SessionReport 미렌더링**: `setShowReport(true)` 호출하지만 JSX에 컴포넌트 렌더링 코드 누락
2. **AudioContext 예외**: `close()` 이미 닫힌 상태에서 재호출 시 예외 발생
3. **PCM 버퍼 손상**: `postMessage(this.buffer)` - 동일 참조 전송으로 덮어쓰기 발생
4. **타이머 누수**: `interval` 변수가 undefined일 때 cleanup 미처리
5. **SubtitleTurn 재렌더링**: 매 트랜스크립트 업데이트마다 4개 턴 전체 재렌더링
6. **diffWords 중복 호출**: 동일 인자로 2회 호출
7. **세션 정리 레이스**: `disconnect()` 후 즉시 null 할당으로 콜백에서 참조 오류
8. **turnIndex -1**: 유저 턴 없을 때 -1 할당으로 트랜스크립트 내보내기 시 매칭 실패

---

# 해결
| 파일 | 수정 내용 |
|------|----------|
| `App.tsx:1108` | `{showReport && <SessionReport ... />}` 추가 |
| `App.tsx:471,884` | `try-catch`로 `audioContext.close()` 감싸기 |
| `pcm-processor.js:27,36` | `postMessage(this.buffer.slice())` - 복제 후 전송 |
| `App.tsx:162-176` | `interval: number \| undefined`, 조건부 cleanup |
| `App.tsx:23-40` | `React.memo`로 `TurnBubble` 컴포넌트 분리 |
| `PracticeMode.tsx:19-22` | `useMemo`로 `diffWords` 결과 캐싱 |
| `App.tsx:456-459` | 로컬 변수에 참조 저장 후 null 할당, 그 후 disconnect |
| `App.tsx:657-659` | `lastUserTurnIndex >= 0`일 때만 `turnIndex` 할당 |

**빌드 결과**: ✅ 성공 (7.79s)

---

# 관련 파일
- `C:/Users/user/Downloads/gemini-cast/App.tsx`
- `C:/Users/user/Downloads/gemini-cast/public/pcm-processor.js`
- `C:/Users/user/Downloads/gemini-cast/components/PracticeMode.tsx`
- `C:/Users/user/Downloads/gemini-cast/components/SessionReport.tsx`

---

# 재발 방지
- **JSX 렌더링 체크**: 상태 변수 추가 시 해당 상태를 사용하는 JSX도 함께 추가
- **리소스 정리**: `close()` 계열 메서드는 항상 try-catch로 감싸기
- **Worker 통신**: SharedArrayBuffer 아니면 `slice()`로 복제 후 전송
- **메모이제이션**: 동일 계산 2회 이상 시 `useMemo` 적용 검토
- **레이스 컨디션**: 비동기 cleanup 시 참조 먼저 저장, null 할당, 그 후 정리 작업

---

# 📝 쉬운 설명

### 문제
앱에서 여러 가지가 안 됐음: 세션 끝나도 결과 화면 안 나옴, 소리 깨짐, 메모리 새는 문제 등 8가지.

### 원인
- **결과 화면**: 화면 켜라는 명령은 있는데, 실제로 화면을 그리는 코드가 없었음
- **소리 깨짐**: 같은 쪽지(버퍼)를 계속 재사용해서, 내용 쓰는 중에 보내버림
- **메모리 누수**: 타이머 끄는 코드가 특정 상황에서 작동 안 함

### 해결
- 결과 화면 그리는 코드 추가
- 쪽지 복사본 만들어서 보내도록 수정
- 타이머 끄는 코드 보완
- 그 외 5가지도 각각 원인에 맞게 수정

### 관련 파일
- `C:/Users/user/Downloads/gemini-cast/App.tsx`
- `C:/Users/user/Downloads/gemini-cast/public/pcm-processor.js`
- `C:/Users/user/Downloads/gemini-cast/components/PracticeMode.tsx`
