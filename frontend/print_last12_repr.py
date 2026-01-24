p = r'src/app/(dashboard)/onedrive/[id]/page.tsx'
lines = open(p, 'r', encoding='utf-8').read().splitlines(True)
for i, l in enumerate(lines[-12:], start=len(lines)-11):
    print(f'{i:4d}: {l!r}')
