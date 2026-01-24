p = r'src/app/(dashboard)/onedrive/[id]/page.tsx'
lines = open(p, 'r', encoding='utf-8').read().splitlines()
start = 720
end = 740
for i in range(start, end+1):
    print(f'{i:4d}: {lines[i-1]}')
