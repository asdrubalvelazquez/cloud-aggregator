# Copilot Instructions for AI Agents

## Project Overview
- **Cloud Aggregator** is a multi-cloud file manager enabling users to connect multiple Google Drive and OneDrive accounts, view storage, and copy files between accounts.
- **Frontend**: Next.js (TypeScript, `/frontend`), deployed on Vercel.
- **Backend**: FastAPI (Python, `/backend`), deployed on Fly.io.
- **Database**: Supabase (PostgreSQL). Used for auth (JWT), user/account mapping, and file transfer jobs.

## Architecture & Data Flow
- **Auth**: Users log in via Supabase OAuth (Google). JWT tokens are used for all backend API calls.
- **Account Linking**: OAuth state param is a signed JWT containing the user_id. Backend decodes this to associate cloud accounts with users.
- **Frontend**: Uses React context (e.g., `CopyContext`) for UI state. All API calls use `authenticatedFetch` (see `src/lib/api.ts`) which attaches the Supabase JWT.
- **Backend**: All endpoints require JWT and filter data by user_id. See `backend/auth.py` for token validation and user extraction.
- **Cross-provider Copy**: Transfers between Google Drive and OneDrive are handled by backend jobs (see `backend/transfer.py`). Progress is tracked and exposed via API.

## Developer Workflows
- **Frontend**:
  - Dev: `npm run dev` in `/frontend` (requires `.env.local` with Supabase/Backend URLs)
  - Build: `npm run build`
  - Lint: `npm run lint`
- **Backend**:
  - Dev: `uvicorn backend.main:app --reload` in `/backend` (requires `.env`)
  - Deploy: `fly deploy` (Fly.io)
  - Install: `pip install -r requirements.txt`
- **Environment Variables**: See `DEPLOYMENT_GUIDE.md` for required env vars for both frontend and backend. Never expose service role keys in frontend.

## Project-Specific Patterns & Conventions
- **API Calls**: Always use `authenticatedFetch` in frontend to ensure JWT is attached.
- **React Context**: Use `CopyContext` for file copy UI state (see `src/context/CopyContext.tsx`).
- **Backend Auth**: All endpoints must check JWT and filter by user_id. Use helpers in `backend/auth.py`.
- **OAuth State**: Always use a signed JWT for the OAuth state param to prevent CSRF and ensure correct user mapping.
- **Error Handling**: Backend endpoints return clear error types (e.g., `invalid_grant`, `no_refresh_token`). Frontend should surface these to users.
- **CORS**: Backend only allows requests from configured frontend URLs (see `DEPLOYMENT_GUIDE.md`).

## Key Files & Directories
- `/frontend/src/lib/api.ts`: API call helper (JWT handling)
- `/frontend/src/context/CopyContext.tsx`: File copy UI state
- `/backend/backend/main.py`: FastAPI app entrypoint
- `/backend/backend/auth.py`: JWT validation, OAuth helpers
- `/backend/backend/transfer.py`: Cross-provider file transfer logic
- `/backend/backend/google_drive.py`, `/backend/backend/onedrive.py`: Cloud provider integrations
- `/DEPLOYMENT_GUIDE.md`: Full setup, env vars, and troubleshooting

## Integration Points
- **Supabase**: Used for auth, user/account mapping, and as a DB. See `backend/db.py` and frontend `.env` usage.
- **Google Drive/OneDrive**: Integrated via backend modules. Tokens are encrypted and refreshed as needed.
- **Frontend↔Backend**: All communication via REST API, authenticated with Supabase JWT.

## Examples
- To add a new API endpoint, ensure it requires JWT and filters by user_id.
- To add a new frontend feature that calls the backend, use `authenticatedFetch` and handle errors as described above.

For more, see `DEPLOYMENT_GUIDE.md` and referenced files.
