# Admin Panel Status

**Estado actual:** UI + Guards + Actions MOCK

## Implementado

- Ruta protegida `/admin` con auth server-side (ADMIN_EMAILS)
- Layout con navegación funcional
- 5 páginas con UI mock:
  - Overview (KPIs)
  - Users (tabla + acciones)
  - Clouds (tabla + acciones)
  - Billing (tabla + acciones)
  - System (métricas)
- Guard centralizado (`adminGuard.ts`)
- Actions mock con audit log (`adminActions.ts`, `adminAuditLog.ts`)
- API placeholders (`adminApi.ts`)

## Pendiente

- Backend real para acciones admin
- Endpoints API reales
- Roles en base de datos
- Persistencia de audit log
- Tipos TypeScript completos
- Confirm dialogs

## Archivos clave

```
frontend/src/
  app/admin/
    page.tsx (redirect a overview)
    layout.tsx (navegación)
    (protected)/
      layout.tsx (auth guard)
      overview/page.tsx
      users/page.tsx
      clouds/page.tsx
      billing/page.tsx
      system/page.tsx
  lib/
    adminGuard.ts
    adminActions.ts
    adminAuditLog.ts
    adminApi.ts
```
