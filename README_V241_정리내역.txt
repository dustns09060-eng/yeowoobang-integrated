여우방 V241 정리·안정화본

이번 작업 기준
- 사용자가 업로드한 yeowoobang-integrated-main(5).zip의 V240 소스를 기준으로 직접 점검
- 잘 되는 기능은 유지하고 확실히 불필요한 파일/코드만 제거

정리한 항목
1. 메인에서 이미 제거된 품앗이의 잔여 CSS 전체 삭제
2. pumasi-config.js 삭제
3. sw.js에서 품앗이/과거 미사용 캐시 항목 삭제
4. 오래된 V68~V129 및 깨진 한글 안내 TXT 17개 삭제
5. Service Worker 캐시명을 V241로 갱신
6. app.js/style.css/sw.js 캐시버스트를 V241로 통일
7. TOP3 그래픽(top3_scene_v240.jpg)을 Service Worker 정적자원에 포함

유지한 파일
- .nojekyll / CNAME : GitHub Pages 및 도메인
- privacy.html / terms.html / child-safety.html / data-deletion.html : 정책/Play 관련 페이지
- admin.html + styles.css + config.js + api.js : 독립 관리자 페이지 구성
- Code.gs + Styles.html : Apps Script 소스/백업
- config.json + room-list.csv : 프로그램 fallback 설정
- supabase-auth-v107.* : app.js가 선택적 인증 훅을 가지고 있어 보존
- backend-adapter-v106.* : 향후/비상 어댑터이므로 안전상 보존
- 로고/아이콘/preview 이미지 : 실제 manifest/index에서 참조

배포
GitHub 저장소 내용을 이 V241 폴더 전체 기준으로 덮어쓰는 것을 권장합니다.
Apps Script 자체 코드는 변경하지 않았습니다.
AAB 재업로드도 필요하지 않습니다.
