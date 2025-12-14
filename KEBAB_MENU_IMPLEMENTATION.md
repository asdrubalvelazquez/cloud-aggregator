# Implementación de Menú Kebab para Acciones de Archivos

## 📋 Resumen de Cambios

Se reemplazó la columna de acciones con botones visibles por un menú kebab (tres puntos) estilo Google Drive. Este cambio es **solo de UI** y mantiene toda la lógica existente intacta.

## 🔧 Archivos Modificados/Creados

### 1. Nuevo Componente: `frontend/src/components/RowActionsMenu.tsx`

**Archivo completo creado** - Este componente maneja el menú desplegable para cada fila.

### 2. Modificaciones en `frontend/src/app/drive/[id]/page.tsx`

#### ANTES / DESPUÉS - Import del nuevo componente

**ANTES:**
```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";
import { authenticatedFetch } from "@/lib/api";
import QuotaBadge from "@/components/QuotaBadge";
```

**DESPUÉS:**
```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";
import { authenticatedFetch } from "@/lib/api";
import QuotaBadge from "@/components/QuotaBadge";
import RowActionsMenu from "@/components/RowActionsMenu";
```

---

#### ANTES / DESPUÉS - Columna de Acciones en la tabla

**ANTES:**
```tsx
                    {/* Fecha de modificación */}
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {file.modifiedTime ? formatDate(file.modifiedTime) : "-"}
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {/* Ver/Abrir */}
                        {file.mimeType === "application/vnd.google-apps.folder" ? (
                          <button
                            type="button"
                            onClick={() => handleOpenFolder(file.id, file.name)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1"
                          >
                            📂 Abrir
                          </button>
                        ) : (
                          file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1"
                            >
                              👁️ Ver
                            </a>
                          )
                        )}
                        
                        {/* Copiar */}
                        <button
                          disabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                          onClick={() => openCopyModal(file.id, file.name)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          📋 Copiar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
```

**DESPUÉS:**
```tsx
                    {/* Fecha de modificación */}
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {file.modifiedTime ? formatDate(file.modifiedTime) : "-"}
                    </td>

                    {/* Acciones - Kebab Menu */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <RowActionsMenu
                          fileId={file.id}
                          fileName={file.name}
                          mimeType={file.mimeType}
                          webViewLink={file.webViewLink}
                          isFolder={file.mimeType === "application/vnd.google-apps.folder"}
                          onOpenFolder={handleOpenFolder}
                          onCopy={openCopyModal}
                          copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
```

---

## ✨ Características Implementadas

### Para Carpetas
- ✅ Muestra opción "📂 Abrir"
- ✅ Opción "📋 Copiar" **deshabilitada** con tooltip: _"No se pueden copiar carpetas aún"_
- ✅ Evita error 500 al intentar copiar carpetas

### Para Archivos
- ✅ Muestra "👁️ Ver" (si `webViewLink` existe)
- ✅ Muestra "📋 Copiar" (habilitado según estado global)

### UI/UX
- ✅ Icono de menú (⋮) alineado a la derecha
- ✅ Buen contraste y accesibilidad
- ✅ Se cierra al hacer clic fuera del menú
- ✅ Se cierra automáticamente al seleccionar una opción
- ✅ Hover states y transiciones suaves
- ✅ **Sin librerías externas** - Solo React + Tailwind

### Lógica Preservada
- ✅ **Cero cambios en endpoints o payloads**
- ✅ Reutiliza los mismos handlers: `handleOpenFolder`, `openCopyModal`
- ✅ Mantiene selección múltiple intacta
- ✅ Mantiene batch copy funcional
- ✅ Mantiene QuotaBadge visible
- ✅ Mantiene detección de duplicados

---

## 🧪 Cómo Probar (5 Pasos)

### 1. **Probar con Archivo Normal**
   - Navega a la vista de archivos de una cuenta
   - Haz clic en el menú kebab (⋮) de un archivo (no carpeta)
   - Verifica que aparecen las opciones "👁️ Ver" y "📋 Copiar"
   - Selecciona "Ver" → debe abrir el archivo en una nueva pestaña
   - Selecciona "Copiar" → debe abrir el modal de copia normal

### 2. **Probar con Carpeta**
   - Haz clic en el menú kebab (⋮) de una carpeta
   - Verifica que aparece "📂 Abrir"
   - Verifica que "📋 Copiar" está deshabilitado (opaco)
   - Haz hover sobre "Copiar" → debe aparecer tooltip: _"No se pueden copiar carpetas aún"_
   - Selecciona "Abrir" → debe navegar dentro de la carpeta

### 3. **Verificar Detección de Duplicados**
   - Copia un archivo a una cuenta destino (primera vez)
   - Intenta copiar el **mismo archivo** nuevamente a la **misma cuenta**
   - Verifica que aparece el mensaje: _"ℹ️ El archivo ya existe en la cuenta destino. No se realizó copia ni se consumió cuota."_
   - Confirma que el modal se cierra automáticamente después de 5 segundos

### 4. **Probar Batch Copy (Selección Múltiple)**
   - Selecciona múltiples archivos usando los checkboxes
   - Selecciona una cuenta destino en el dropdown superior
   - Haz clic en "Copiar seleccionados"
   - Verifica que el progreso se muestra correctamente: _"Copiando X/Y..."_
   - Confirma que al finalizar aparece el resumen: _"✅ Éxito: X, ℹ️ Omitidos: Y, ❌ Fallidos: Z"_

### 5. **Verificar Quota Badge Visible**
   - Observa el badge de cuota en la esquina superior derecha
   - Realiza una copia exitosa
   - Verifica que el badge de cuota se actualiza automáticamente
   - Confirma que el progreso y estado siguen visibles durante la operación

---

## 🎯 Notas Técnicas

- El componente `RowActionsMenu` usa `useRef` y `useEffect` para detectar clics fuera del menú
- El tooltip en carpetas usa CSS puro (`:hover` + `opacity`)
- El menú se posiciona con `absolute` y `z-index: 50` para superponerse correctamente
- Los iconos emoji (📂, 👁️, 📋) mantienen consistencia visual con el diseño anterior
- El estado `isOpen` es local a cada fila, no global

---

## ⚠️ Restricciones Cumplidas

✅ **No se modificó lógica de backend** (endpoints, payloads intactos)  
✅ **Reutiliza handlers existentes** (`handleOpenFolder`, `openCopyModal`)  
✅ **Selección múltiple funciona** igual que antes  
✅ **Batch copy sin cambios**  
✅ **Quota badge visible** y se actualiza correctamente  
✅ **Detección de duplicados preservada**  
✅ **Carpetas no se pueden copiar** (evita error 500)  
✅ **Solo cambio de UI** - Sin librerías nuevas  

---

## 📦 Archivos Finales

```
frontend/src/
├── components/
│   ├── RowActionsMenu.tsx  ← NUEVO
│   └── QuotaBadge.tsx
└── app/
    └── drive/
        └── [id]/
            └── page.tsx  ← MODIFICADO
```

---

**Implementación completada** ✅
