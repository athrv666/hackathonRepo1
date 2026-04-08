# Changelog

## Recent changes

1) Fix frontend “blank screen”
- Added a router error page so crashes show a readable error instead of blank UI.
- Files: `frontend/src/app/components/ErrorPage.tsx`, `frontend/src/app/routes.tsx`

2) Fix `apiFetchBlob` export error
- Implemented and exported `apiFetchBlob` from the API helper so `ReportPreview` can import it.
- File: `frontend/src/app/lib/api.ts`

3) Fix “Apply Configuration B” button not working
- Added real behavior to the button (it previously had no handler).
- It now applies the optimized config logic correctly (initially it navigated/updated storage; later adjusted per your requirement).
- File: `frontend/src/app/pages/dashboard/ComparisonScreen.tsx`

4) Make input values persist until “Clear saved”
- Added draft saving (`uiDraft`) for Input fields (temps/layers) so values remain after refresh until cleared.
- Backend allowlist updated to accept `uiDraft`, frontend hydrates and auto-saves draft.
- Files:
  - `backend/routes/state.js`
  - `frontend/src/app/App.tsx`
  - `frontend/src/app/pages/dashboard/InputDashboard.tsx`
  - `frontend/src/app/components/layout/DashboardNav.tsx`

5) Update report: “Simulation Accuracy” → “Heat Loss”
- Replaced the placeholder card with Heat Loss and a working value:
  - \(\\text{Heat Loss} = \\text{heat\\_flux} \\times \\text{area}\\)
- File: `frontend/src/app/pages/dashboard/ReportPreview.tsx`

