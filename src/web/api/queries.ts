/**
 * Consultas y operaciones de la API (React Query).
 * Como todo está conectado (un pedido mueve stock, el stock cambia el tablero…),
 * después de cualquier operación se refrescan todas las consultas.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import type {
  Activity, ActivityFilter, Company, DashboardData, InventoryCount, InventoryCountDetail, InventoryRow, Location,
  LocationDetail, Movement, NewOrderInput, Notification, OrderDetail, OrderStatus, OrderSummary, OrderType, Product,
  ProductDetail, ProductStock, Quote, RackDetail, RackPosition, Role, Session, StockStatus, User, Warehouse, WarehouseMap,
} from '../../shared/types'
import type { RackConfiguration } from '../../shared/rack/types'
import { api, qs } from './client'

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>

const q = <T>(key: unknown[], path: string | null, opts?: Opts<T>) =>
  useQuery<T>({ queryKey: key, queryFn: () => api.get<T>(path!), enabled: path !== null && (opts?.enabled ?? true), ...opts })

/* ------------------------------ Lecturas ------------------------------ */

export const useDashboard = () => q<DashboardData>(['dashboard'], '/dashboard', { refetchInterval: 30_000 })
export const useNotifications = () => q<{ items: Notification[]; unread: number }>(['notifications'], '/notifications', { refetchInterval: 15_000 })

export interface OrdersFilter { status?: OrderStatus[]; type?: OrderType; search?: string; mine?: boolean }
export const useOrders = (f: OrdersFilter = {}) =>
  q<OrderSummary[]>(['orders', f], `/orders${qs({ status: f.status?.join(','), type: f.type, search: f.search, mine: f.mine })}`)
export const useOrder = (id: number | null) => q<OrderDetail>(['order', id], id ? `/orders/${id}` : null)

export const useCatalog = () => q<(Product & { available: number })[]>(['catalog'], '/products/catalog')
export const useProducts = (f: { search?: string; category?: string; status?: StockStatus | 'faltantes' } = {}, enabled = true) =>
  q<ProductStock[]>(['products', f], `/products${qs(f)}`, { enabled })
export const useProduct = (id: number | null) => q<ProductDetail>(['product', id], id ? `/products/${id}` : null)
export const useCategories = () => q<string[]>(['categories'], '/products/categories')
export const useStaging = (enabled = true) => q<InventoryRow[]>(['staging'], '/inventory/staging', { enabled })
export const useMovements = (f: { productId?: number; orderId?: number; limit?: number }) => q<Movement[]>(['movements', f], `/movements${qs(f)}`)

export const useWarehouses = () => q<Warehouse[]>(['warehouses'], '/warehouses')
export const useWarehouseMap = (id: number, enabled = true) => q<WarehouseMap>(['map', id], `/warehouses/${id}/map`, { enabled })
export const usePositions = (id: number, enabled = true) => q<RackPosition[]>(['positions', id], `/warehouses/${id}/positions`, { enabled })
export const useSectors = (id: number) => q<string[]>(['sectors', id], `/warehouses/${id}/sectors`)
export const useRack = (id: number | null) => q<RackDetail>(['rack', id], id ? `/racks/${id}` : null)
export const useLocation = (code: string | null) => q<LocationDetail>(['location', code], code ? `/locations/${encodeURIComponent(code)}` : null)
export const useLocations = (search: string, freeOnly = false, enabled = true) =>
  q<(Location & { units: number; products: number })[]>(['locations', search, freeOnly], `/locations${qs({ search, free: freeOnly })}`, { enabled })

export const useCounts = (enabled = true) => q<InventoryCount[]>(['counts'], '/counts', { enabled })
export const useCount = (id: number | null) => q<InventoryCountDetail>(['count', id], id ? `/counts/${id}` : null)

export const useActivity = (f: ActivityFilter) =>
  q<Activity[]>(['activity', f], `/activity${qs(f as Record<string, string | number | undefined>)}`)

export const useUsers = (role?: Role) => q<User[]>(['users', role], `/users${qs({ role })}`)
export const useCompanies = () => q<Company[]>(['companies'], '/companies')
export const useRoles = () => q<{ permissions: Record<string, string>; roles: Record<Role, string>; matrix: Record<Role, string[]> }>(['roles'], '/roles')
export const useQuotes = (enabled = true) => q<Quote[]>(['quotes'], '/quotes', { enabled })
export const useDemoUsers = () =>
  q<{ password: string | null; users: { name: string; email: string; role: Role; roleLabel: string; sector: string }[] }>(['demo-users'], '/demo/users', { staleTime: Infinity })

/* ------------------------------ Operaciones ------------------------------ */

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation<O, Error, I>({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries(),
  })
}

export const useCreateOrder = () => useAction((input: NewOrderInput) => api.post<OrderDetail>('/orders', input))
export const useTransition = (id: number) =>
  useAction((input: { to: OrderStatus; note?: string; assigneeId?: number | null }) => api.post<OrderDetail>(`/orders/${id}/transition`, input))
export const usePick = (id: number) => useAction((input: { itemId: number; picked: boolean }) => api.post<OrderDetail>(`/orders/${id}/items/${input.itemId}/pick`, { picked: input.picked }))
export const useReserve = (id: number) => useAction(() => api.post<OrderDetail>(`/orders/${id}/reserve`))
export const useReceive = (id: number) =>
  useAction((input: { lines: { itemId: number; quantity: number; locationId: number }[]; note?: string }) => api.post<OrderDetail>(`/orders/${id}/receive`, input))
export const useComment = (id: number) => useAction((body: string) => api.post<OrderDetail>(`/orders/${id}/comments`, { body }))

export const useReplenish = () => useAction((input: { productId: number; quantity?: number }) =>
  api.post<OrderDetail>(`/products/${input.productId}/replenish`, { quantity: input.quantity }))
export const useStockIn = () => useAction((input: { productId: number; locationId: number; quantity: number; note?: string }) => api.post('/inventory/receive', input))
export const useStockMove = () => useAction((input: { inventoryId: number; toLocationId: number; quantity: number; note?: string }) => api.post('/inventory/move', input))
export const useSaveProduct = () => useAction((input: { id?: number; code: string; name: string; category: string; unit: string; minStock: number; description?: string; active?: boolean }) =>
  input.id ? api.put<ProductStock>(`/products/${input.id}`, input) : api.post<ProductStock>('/products', input))

export const useCreateRack = () => useAction((input: { warehouseId: number; aisle: string; config: RackConfiguration }) => api.post<RackDetail>('/racks', input))
export const useDeleteRack = () => useAction((id: number) => api.del(`/racks/${id}`))

export const useStartCount = () => useAction((input: { warehouseId: number; sector: string }) => api.post<InventoryCountDetail>('/counts', input))
export const useCountLine = (id: number) => useAction((input: { lineId: number; countedQty: number | null }) =>
  api.patch<InventoryCountDetail>(`/counts/${id}/lines/${input.lineId}`, { countedQty: input.countedQty }))
export const useConfirmCount = (id: number) => useAction(() => api.post<InventoryCountDetail>(`/counts/${id}/confirm`))
export const useCancelCount = (id: number) => useAction(() => api.post<InventoryCountDetail>(`/counts/${id}/cancel`))

export const useReadNotifications = () => useAction((input: { ids?: number[]; all?: boolean }) => api.post('/notifications/read', input))

export const useSaveUser = () => useAction((input: { id?: number; name: string; email: string; role: Role; companyId: number; sector?: string; password?: string; active?: boolean }) =>
  input.id ? api.patch<User>(`/users/${input.id}`, input) : api.post<User>('/users', input))
export const useCreateQuote = () => useAction((input: { config: RackConfiguration; comments?: string }) => api.post<Quote>('/quotes', input))
export const useAnswerQuote = () => useAction((id: number) => api.post<Quote>(`/quotes/${id}/answered`))
export const useCreateCompany = () => useAction((input: { name: string; kind: 'interna' | 'cliente'; sectors: string[] }) => api.post<Company>('/companies', input))

export const useLogin = () => useMutation<Session, Error, { email: string; password: string }>({
  mutationFn: (input) => api.post<Session>('/auth/login', input),
})
