# 🎨 Frontend Implementation: Ownership Transfer Modal

## 📋 Overview
Implementar modal de confirmación cuando se detecta `ownership_conflict` con `transfer_token` en query params.

---

## 🔗 Detección de Conflicto

### URL Pattern
```
/app?error=ownership_conflict&transfer_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Query Params
- `error=ownership_conflict`: Indica conflicto de ownership
- `transfer_token`: JWT firmado (TTL 10 min) con datos de transferencia

---

## 🎭 Modal UI (Mínimo Requerido)

### Contenido del Modal

**Título:**
```
Account Already Connected
```

**Mensaje:**
```
This OneDrive account is already connected to another user.

Do you want to transfer this account to your profile?
This will disconnect it from the previous owner.
```

**Botones:**
- **Cancel** → Cierra modal, limpia query params
- **Transfer Account** → Llama API, muestra loading

### Estado del Modal
```typescript
interface TransferModalState {
  isOpen: boolean;
  transferToken: string;
  isLoading: boolean;
  error: string | null;
}
```

---

## 🔌 API Call

### Endpoint
```
POST /cloud/transfer-ownership
```

### Request
```typescript
{
  transfer_token: string  // Del query param
}
```

### Response Success (200)
```typescript
{
  success: true,
  account_id: string,
  message: "onedrive account transferred successfully"
}
```

### Response Error
- **400**: Token inválido/expirado → Mostrar "Transfer link expired. Please reconnect again."
- **403**: Usuario no autorizado → Mostrar "Unauthorized transfer"
- **409**: Owner cambió → Mostrar "Account ownership changed. Please retry."
- **404**: Cuenta no existe → Mostrar "Account not found"
- **500**: Error DB → Mostrar "Transfer failed. Please try again."

---

## 🎯 Flujo Completo

### 1. Detección (useEffect)
```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  const transferToken = params.get('transfer_token');
  
  if (error === 'ownership_conflict' && transferToken) {
    setTransferModalState({
      isOpen: true,
      transferToken: transferToken,
      isLoading: false,
      error: null
    });
  }
}, []);
```

### 2. Handler: Cancel
```typescript
const handleCancelTransfer = () => {
  // Cerrar modal
  setTransferModalState(prev => ({ ...prev, isOpen: false }));
  
  // Limpiar query params
  const url = new URL(window.location.href);
  url.searchParams.delete('error');
  url.searchParams.delete('transfer_token');
  window.history.replaceState({}, '', url.toString());
};
```

### 3. Handler: Confirm Transfer
```typescript
const handleConfirmTransfer = async () => {
  setTransferModalState(prev => ({ ...prev, isLoading: true, error: null }));
  
  try {
    const response = await fetch('/api/cloud/transfer-ownership', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`  // JWT del usuario actual
      },
      body: JSON.stringify({
        transfer_token: transferModalState.transferToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Transfer failed');
    }
    
    const result = await response.json();
    
    // Success: cerrar modal, limpiar params, refrescar lista de nubes
    setTransferModalState(prev => ({ ...prev, isOpen: false }));
    
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('transfer_token');
    window.history.replaceState({}, '', url.toString());
    
    // Refrescar lista de cuentas cloud
    await fetchCloudAccounts();
    
    // Opcional: Mostrar toast de éxito
    showSuccessToast('Account transferred successfully!');
    
  } catch (error) {
    // Mostrar error en modal
    setTransferModalState(prev => ({
      ...prev,
      isLoading: false,
      error: error.message
    }));
  }
};
```

### 4. Refrescar Lista de Nubes
Después del transfer exitoso, llamar al endpoint existente:
```typescript
const fetchCloudAccounts = async () => {
  // GET /clouds (o el endpoint que liste cuentas)
  // Actualizar estado de la UI con nuevas cuentas
};
```

---

## 🎨 Modal Component (Ejemplo)

```tsx
<Modal
  isOpen={transferModalState.isOpen}
  onClose={handleCancelTransfer}
  title="Account Already Connected"
>
  <div className="space-y-4">
    <p className="text-gray-700">
      This OneDrive account is already connected to another user.
    </p>
    <p className="text-gray-700">
      Do you want to transfer this account to your profile? 
      This will disconnect it from the previous owner.
    </p>
    
    {transferModalState.error && (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700">
        {transferModalState.error}
      </div>
    )}
    
    <div className="flex gap-3 justify-end">
      <button
        onClick={handleCancelTransfer}
        disabled={transferModalState.isLoading}
        className="px-4 py-2 border rounded hover:bg-gray-50"
      >
        Cancel
      </button>
      
      <button
        onClick={handleConfirmTransfer}
        disabled={transferModalState.isLoading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {transferModalState.isLoading ? 'Transferring...' : 'Transfer Account'}
      </button>
    </div>
  </div>
</Modal>
```

---

## ✅ Testing Checklist

### Manual Testing
1. ✅ **Happy Path**: Mostrar modal → Confirmar → Transfer exitoso → Modal cierra → Lista actualizada
2. ✅ **Cancel**: Mostrar modal → Cancel → Modal cierra → Query params limpiados
3. ✅ **Token Expirado**: Esperar >10 min → Confirmar → Error "Transfer link expired"
4. ✅ **Concurrent Change**: Otro usuario transfiere primero → Error "Account ownership changed"
5. ✅ **Network Error**: Simular 500 → Error "Transfer failed"

### Edge Cases
- ✅ Usuario cierra modal y vuelve a abrir el link → Modal reaparece
- ✅ Usuario refresh la página con query params → Modal aparece automáticamente
- ✅ Token inválido (manipulado) → Error 400
- ✅ Usuario sin sesión → Redirect a login primero

---

## 📝 Notes

### No Cambiar
- ❌ NO modificar flujo normal de conexión (sin conflicto)
- ❌ NO cambiar UI de lista de nubes (solo agregar modal)
- ❌ NO tocar SAFE RECLAIM automático (email match)

### Mantener
- ✅ Query params `?connection=success` para flujos normales
- ✅ Error handling existente para otros errores OAuth
- ✅ Loading states durante OAuth flow

---

**Implementación:** Frontend Developer  
**Prioridad:** Alta (bloquea conexión de cuentas compartidas)  
**Tiempo estimado:** 2-3 horas
