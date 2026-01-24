p = r'C:/Users/asdru/OneDrive/OneDrive - Suscripciones/python/cloud-aggregator 2/frontend/src/app/(dashboard)/onedrive/[id]/page.tsx'
lines = open(p, 'r', encoding='utf-8').read().splitlines()
for i, l in enumerate(lines, start=1):
    if 'return (' in l:
        print(i, l.strip())
