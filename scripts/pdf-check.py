from pathlib import Path
from PIL import Image, ImageDraw
import pypdfium2 as pdfium

root = Path(__file__).resolve().parent.parent
out = root / 'test-results'
out.mkdir(exist_ok=True)
for path in (root / 'output/pdf').glob('*.pdf'):
    pdf = pdfium.PdfDocument(str(path))
    cell_w, cell_h = 220, 335
    sheet = Image.new('RGB', (cell_w * 6, cell_h * ((len(pdf) + 5) // 6)), '#e3e7df')
    draw = ImageDraw.Draw(sheet)
    for i, page in enumerate(pdf):
        image = page.render(scale=.36).to_pil().convert('RGB')
        image.thumbnail((cell_w - 12, cell_h - 30))
        x, y = (i % 6) * cell_w + 6, (i // 6) * cell_h + 6
        sheet.paste(image, (x, y))
        draw.text((x, y + cell_h - 23), f'{path.stem} / {i + 1}', fill='#324328')
    sheet.save(out / f'{path.stem}-pages.png')
    # Check representative long answers and code examples at reading resolution.
    detail_pages = {'software-engineer': 17, 'senior-software-engineer': 19, 'ai-engineer': 20, 'system-design': 17, 'frontend-engineer': 14, 'backend-engineer': 14, 'fundamentals': 24}
    pdf[detail_pages[path.stem]].render(scale=1.4).to_pil().save(out / f'{path.stem}-detail.png')
print('Rendered every page of all seven PDFs into review contact sheets.')
