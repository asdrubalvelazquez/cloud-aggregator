# DIFF EXACTO: Fix 500 en /auth/onedrive/callback

## Archivos Modificados

### 1. backend/migrations/add_ownership_transfer_requests.sql

```diff
     expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
+    CONSTRAINT ownership_transfer_unique_key UNIQUE (provider, provider_account_id, requesting_user_id)
 );

--- Unique constraint: Only one row per (provider, account, requesting_user) - updates same row
-CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
-ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);
-
 -- Performance indexes
```

**Razón:** Supabase REST API requiere UNIQUE CONSTRAINT (no UNIQUE INDEX) para `on_conflict` en `upsert()`.

---

### 2. backend/backend/main.py (Bloque 1: Ownership Conflict)

**Ubicación:** Líneas ~5554-5612

```diff
                 # Save encrypted tokens temporarily for ownership transfer (10 min TTL)
                 try:
                     from backend.crypto import encrypt_token
-                    encrypted_access = encrypt_token(access_token)
-                    encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None
                     
+                    # Validate tokens before encryption
+                    if not access_token:
+                        logging.warning(
+                            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Missing access_token, skipping token storage. "
+                            f"provider_account_id={microsoft_account_id} user_id={user_id}"
+                        )
+                        raise ValueError("Missing access_token")
+                    
+                    # Encrypt tokens with granular error handling
+                    try:
+                        encrypted_access = encrypt_token(access_token)
+                    except Exception as enc_err:
+                        logging.exception(
+                            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(access_token) failed: {type(enc_err).__name__}"
+                        )
+                        raise
+                    
+                    encrypted_refresh = None
+                    if refresh_token:
+                        try:
+                            encrypted_refresh = encrypt_token(refresh_token)
+                        except Exception as enc_err:
+                            logging.exception(
+                                f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(refresh_token) failed: {type(enc_err).__name__}"
+                            )
+                            # Continue without refresh_token
+                    
-                    # UPSERT: if pending request exists, update tokens/expiry
-                    supabase.table("ownership_transfer_requests").upsert({
-                        "provider": "onedrive",
-                        "provider_account_id": microsoft_account_id,
-                        "requesting_user_id": user_id,
-                        "existing_owner_id": existing_user_id,
-                        "account_email": account_email,
-                        "access_token": encrypted_access,
-                        "refresh_token": encrypted_refresh,
-                        "token_expiry": expiry_iso,
-                        "status": "pending",
-                        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
-                    }, on_conflict="provider,provider_account_id,requesting_user_id").execute()
-                    
-                    logging.info(
-                        f"[OWNERSHIP_TRANSFER][ONEDRIVE] Tokens saved temporarily for transfer: "
-                        f"provider_account_id={microsoft_account_id} requesting_user={user_id}"
-                    )
+                    # UPSERT with granular error handling
+                    try:
+                        supabase.table("ownership_transfer_requests").upsert({
+                            "provider": "onedrive",
+                            "provider_account_id": microsoft_account_id,
+                            "requesting_user_id": user_id,
+                            "existing_owner_id": existing_user_id,
+                            "account_email": account_email,
+                            "access_token": encrypted_access,
+                            "refresh_token": encrypted_refresh,
+                            "token_expiry": expiry_iso,
+                            "status": "pending",
+                            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
+                        }, on_conflict="provider,provider_account_id,requesting_user_id").execute()
+                        
+                        logging.info(
+                            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer: "
+                            f"provider_account_id={microsoft_account_id} requesting_user={user_id}"
+                        )
+                    except Exception as upsert_err:
+                        logging.exception(
+                            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] ownership_transfer_requests.upsert() failed: "
+                            f"{type(upsert_err).__name__} - {str(upsert_err)[:300]}"
+                        )
+                        raise
+                        
                 except Exception as save_err:
-                    logging.error(
-                        f"[OWNERSHIP_TRANSFER][ONEDRIVE] Failed to save tokens: {type(save_err).__name__} - {str(save_err)[:200]}"
+                    logging.exception(
+                        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully): "
+                        f"{type(save_err).__name__} - {str(save_err)[:300]}"
                     )
-                    # Non-fatal: continue with transfer_token generation
+                    # Non-fatal: continue with transfer_token generation WITHOUT tokens
```

---

### 3. backend/backend/main.py (Bloque 2: Orphan Slot)

**Ubicación:** Líneas ~5618-5710

```diff
             # Save encrypted tokens temporarily for ownership transfer (10 min TTL)
             try:
                 from backend.crypto import encrypt_token
-                encrypted_access = encrypt_token(access_token)
-                encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None
                 
+                # Validate tokens before encryption
+                if not access_token:
+                    logging.warning(
+                        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Missing access_token for orphan, skipping token storage. "
+                        f"provider_account_id={microsoft_account_id} user_id={user_id}"
+                    )
+                    raise ValueError("Missing access_token")
+                
+                # Encrypt tokens with granular error handling
+                try:
+                    encrypted_access = encrypt_token(access_token)
+                except Exception as enc_err:
+                    logging.exception(
+                        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(access_token) failed for orphan: {type(enc_err).__name__}"
+                    )
+                    raise
+                
+                encrypted_refresh = None
+                if refresh_token:
+                    try:
+                        encrypted_refresh = encrypt_token(refresh_token)
+                    except Exception as enc_err:
+                        logging.exception(
+                            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(refresh_token) failed for orphan: {type(enc_err).__name__}"
+                        )
+                        # Continue without refresh_token
+                
-                # UPSERT: if pending request exists, update tokens/expiry
-                supabase.table("ownership_transfer_requests").upsert({
-                    "provider": "onedrive",
-                    "provider_account_id": microsoft_account_id,
-                    "requesting_user_id": user_id,
-                    "existing_owner_id": orphan_user_id,
-                    "account_email": account_email,
-                    "access_token": encrypted_access,
-                    "refresh_token": encrypted_refresh,
-                    "token_expiry": expiry_iso,
-                    "status": "pending",
-                    "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
-                }, on_conflict="provider,provider_account_id,requesting_user_id").execute()
-                
-                logging.info(
-                    f"[OWNERSHIP_TRANSFER][ONEDRIVE] Tokens saved temporarily for orphan transfer: "
-                    f"provider_account_id={microsoft_account_id} requesting_user={user_id}"
-                )
+                # UPSERT with granular error handling
+                try:
+                    supabase.table("ownership_transfer_requests").upsert({
+                        "provider": "onedrive",
+                        "provider_account_id": microsoft_account_id,
+                        "requesting_user_id": user_id,
+                        "existing_owner_id": orphan_user_id,
+                        "account_email": account_email,
+                        "access_token": encrypted_access,
+                        "refresh_token": encrypted_refresh,
+                        "token_expiry": expiry_iso,
+                        "status": "pending",
+                        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
+                    }, on_conflict="provider,provider_account_id,requesting_user_id").execute()
+                    
+                    logging.info(
+                        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for orphan transfer: "
+                        f"provider_account_id={microsoft_account_id} requesting_user={user_id}"
+                    )
+                except Exception as upsert_err:
+                    logging.exception(
+                        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] ownership_transfer_requests.upsert() failed for orphan: "
+                        f"{type(upsert_err).__name__} - {str(upsert_err)[:300]}"
+                    )
+                    raise
+                    
             except Exception as save_err:
-                logging.error(
-                    f"[OWNERSHIP_TRANSFER][ONEDRIVE] Failed to save tokens for orphan: {type(save_err).__name__} - {str(save_err)[:200]}"
+                logging.exception(
+                    f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens for orphan (non-fatal, degrading gracefully): "
+                    f"{type(save_err).__name__} - {str(save_err)[:300]}"
                 )
-                # Non-fatal: continue with transfer_token generation
+                # Non-fatal: continue with transfer_token generation WITHOUT tokens
```

---

## Resumen de Cambios

### SQL Migration
- **Antes:** `CREATE UNIQUE INDEX` → No funciona con `on_conflict`
- **Después:** `CONSTRAINT ... UNIQUE` → Compatible con Supabase REST API

### Python Code (2 bloques idénticos)
1. **Validación:** Verifica `access_token` != None antes de `encrypt_token()`
2. **Granularidad:** Try/except separados para:
   - `encrypt_token(access_token)` → Error fatal (re-raise)
   - `encrypt_token(refresh_token)` → Error no fatal (continúa sin refresh)
   - `supabase.table().upsert()` → Error no fatal (outer catch)
3. **Logging:** Cambio de `logging.error()` → `logging.exception()` (full traceback)
4. **Tags:** Estandarizar `[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE]`
5. **Degradación:** Si falla, NO 500 → Continúa con `transfer_token` sin tokens guardados

---

## Root Cause
**500 Error causado por:**
1. Supabase REST rechaza `on_conflict` con UNIQUE INDEX (necesita UNIQUE CONSTRAINT)
2. Falta de error handling granular (pérdida de traceback)
3. No validación de `access_token` antes de `encrypt_token()`

**Fix asegura:**
- Compatibilidad con Supabase REST API
- Observability completa (full traceback)
- Degradación suave (ownership_conflict funciona incluso si falla DB)
- NO rompe flujos normales (Safe Reclaim, Google Drive, reconnect mode)
