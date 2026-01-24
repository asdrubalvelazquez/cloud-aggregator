p = r'src/app/(dashboard)/onedrive/[id]/page.tsx'
lines = open(p, 'r', encoding='utf-8').read().splitlines()
start = len(lines) - 80
for i in range(start, len(lines)):
    print(f'{i+1:4d}: {lines[i]}')
