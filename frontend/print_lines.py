p = r'C:/Users/asdru/OneDrive/OneDrive - Suscripciones/python/cloud-aggregator 2/frontend/src/app/(dashboard)/onedrive/[id]/page.tsx'
with open(p, 'r', encoding='utf-8') as f:
    lines = f.readlines()
start, end = 705, 740
for i in range(start, end+1):
    print(f'{i:4d}: {lines[i-1].rstrip()}')
