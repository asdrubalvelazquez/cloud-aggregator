p = r'C:/Users/asdru/OneDrive/OneDrive - Suscripciones/python/cloud-aggregator 2/frontend/src/app/(dashboard)/onedrive/[id]/page.tsx'
lines = open(p, 'r', encoding='utf-8').read().splitlines()
start = 355
end = 405
for i in range(start, end+1):
    print(f'{i:4d}: {lines[i-1]}')
