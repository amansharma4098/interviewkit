"""Generate the customer PDFs and their actual cover previews from one content source."""
import json
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether, Preformatted, Flowable
from reportlab.pdfbase.pdfmetrics import stringWidth
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'output/pdf'
COVERS = ROOT / 'public/covers'
OUTPUT.mkdir(parents=True, exist_ok=True)
COVERS.mkdir(parents=True, exist_ok=True)
content = json.loads((ROOT / 'content/questions.json').read_text())
kits = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import {kits} from './src/catalog.js'; console.log(JSON.stringify(kits))"], cwd=ROOT))
fundamentals = dict(id='fundamentals', number='00', title='The Fundamentals', subtitle='Good answers start here.', experience='Every career stage', questions=50, color='mint', topics=['Core CS', 'Databases', 'Web essentials'])
content['fundamentals'] = [content['software-engineer'][i] for i in [0, 1, 2, 5, 6, 8, 12, 13, 15, 18, 19, 20]]
technical = json.loads((ROOT / 'content/technical-questions.json').read_text())
for kit_id, additions in technical.items():
    content[kit_id].extend(additions)
# Public previews are separated from the private, complete answer bank before bundling.
samples = {kit['id']: content[kit['id']][:3] for kit in kits}
samples['fundamentals'] = content['fundamentals']
(ROOT / 'content/samples.json').write_text(json.dumps(samples, indent=2) + '\n')
kits.append(fundamentals)
palette = {'mint': ('#e0e9d3', '#34593e'), 'blue': ('#dce8ee', '#365f78'), 'lilac': ('#e8e1ee', '#725682'), 'peach': ('#f0ded0', '#875d3c'), 'yellow': ('#ede7c9', '#776a30'), 'rose': ('#eedbe0', '#8b5363')}
W, H = A4
styles = {
    'section': ParagraphStyle('section', fontName='Helvetica-Bold', fontSize=9, leading=13, textColor=colors.HexColor('#527445'), spaceAfter=10),
    'question': ParagraphStyle('question', fontName='Helvetica-Bold', fontSize=14, leading=19, textColor=colors.HexColor('#203627'), spaceAfter=10),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10.5, leading=16.5, textColor=colors.HexColor('#485443'), spaceAfter=9),
    'follow': ParagraphStyle('follow', fontName='Helvetica-Oblique', fontSize=9.5, leading=14, textColor=colors.HexColor('#69825a'), spaceAfter=3),
    'heading': ParagraphStyle('heading', fontName='Helvetica-Bold', fontSize=26, leading=34, textColor=colors.HexColor('#203627'), spaceAfter=20),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=8.3, leading=11.8, textColor=colors.HexColor('#203627'), spaceBefore=7, spaceAfter=12),
}

class PracticeNotes(Flowable):
    """Keep writing space in the document flow so long answers cannot overlap it."""
    def __init__(self):
        super().__init__()
        self.width = W - 96
        self.height = 100

    def draw(self):
        canvas = self.canv
        canvas.setFillColor(colors.HexColor('#819575'))
        canvas.setFont('Helvetica-Bold', 8)
        canvas.drawString(0, 85, 'PRACTICE NOTES')
        canvas.setFont('Helvetica', 8)
        canvas.drawString(0, 70, 'An example, a trade-off, or a question to revisit.')
        canvas.setStrokeColor(colors.HexColor('#e1e8dc'))
        canvas.setLineWidth(.5)
        for y in [50, 27, 4]:
            canvas.line(0, y, self.width, y)

def draw_cover(canvas, doc, kit):
    bg, ink = map(colors.HexColor, palette[kit['color']])
    canvas.setFillColor(bg)
    canvas.rect(0, 0, W, H, stroke=0, fill=1)
    canvas.setFillColor(ink)
    canvas.rect(40, H - 92, 29, 29, stroke=0, fill=1)
    canvas.setFillColor(bg)
    canvas.setFont('Helvetica-Bold', 32)
    canvas.drawString(45, H - 94, '*')
    canvas.setFillColor(ink)
    canvas.setFont('Helvetica-Bold', 21)
    canvas.drawString(80, H - 85, 'PrepTrick.')
    canvas.setFont('Helvetica', 9)
    canvas.drawRightString(W - 44, H - 80, 'INTERVIEW LIBRARY / ' + kit['number'])
    canvas.setStrokeColor(ink)
    canvas.setLineWidth(.6)
    canvas.line(44, H - 120, W - 44, H - 120)
    canvas.setFont('Helvetica-Bold', 10)
    canvas.drawString(44, H - 175, kit['experience'].upper())
    title = Paragraph(escape(kit['title']), ParagraphStyle('cover-title', fontName='Helvetica-Bold', fontSize=43, leading=51, textColor=ink, alignment=TA_LEFT))
    _, height = title.wrap(W - 110, 300)
    title.drawOn(canvas, 44, H - 215 - height)
    canvas.setFont('Helvetica', 14)
    canvas.drawString(44, H - 245 - height, kit['subtitle'])
    canvas.setLineWidth(1.3)
    start_y = 190
    for i in range(4):
        y = start_y + i * 23
        canvas.line(44, y, 190 + i * 69, y)
        canvas.line(183 + i * 69, y - 6, 190 + i * 69, y)
        canvas.line(183 + i * 69, y + 6, 190 + i * 69, y)
    canvas.setFont('Helvetica-Bold', 11)
    canvas.drawString(44, 123, f"{kit['questions']} QUESTIONS. CLEAR ANSWERS.")
    canvas.setFont('Helvetica', 10)
    canvas.drawString(44, 105, 'Follow-up prompts. A more confident next step.')
    canvas.line(44, 76, W - 44, 76)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(44, 52, 'ORIGINAL PRACTICE MATERIAL')
    canvas.drawRightString(W - 44, 52, 'SEPTEMBER 2026 EDITION')

def footer(canvas, doc, kit):
    canvas.setStrokeColor(colors.HexColor('#dbe4d3'))
    canvas.setLineWidth(.5)
    canvas.line(46, H - 42, W - 46, H - 42)
    canvas.line(46, 45, W - 46, 45)
    canvas.setFillColor(colors.HexColor('#7d8d72'))
    canvas.setFont('Helvetica', 8)
    canvas.drawString(46, H - 32, 'PREPTRICK / ' + kit['title'].upper())
    canvas.drawString(46, 29, 'Personal study edition | Original, independent practice material')
    canvas.drawRightString(W - 46, 29, str(doc.page - 1))

for kit in kits:
    entries = content[kit['id']]
    assert len(entries) == kit['questions'] and len(entries) >= 50, kit['id']
    assert len({q[1].casefold() for q in entries}) == len(entries), f"Duplicate question in {kit['id']}"
    story = [Spacer(1, 2), PageBreak()]
    story.extend([Paragraph('Make the preparation count.', styles['heading']), Paragraph('Read an answer, close the page, and explain the idea in your own words. Then work through the follow-up. A strong interview answer includes the conditions, trade-offs, and an example - not just a definition.', styles['body']), Spacer(1, 14), Paragraph('YOUR STUDY ROUTE', styles['section'])])
    sections = list(dict.fromkeys(q[0] for q in entries))
    for section in sections:
        count = sum(q[0] == section for q in entries)
        story.append(Paragraph(f'{escape(section)}  /  {count} questions', styles['body']))
    story.extend([Spacer(1, 25), Paragraph('Three passes through the kit', styles['question']), Paragraph('1. Understand: read each answer and identify the core idea.<br/>2. Explain: answer aloud without looking and add an example.<br/>3. Extend: solve the follow-up and write down what is still unclear.', styles['body']), Spacer(1, 20), Paragraph('About this edition', styles['question']), Paragraph('These questions are independently authored around common engineering interview topics. They are not sourced from or endorsed by an employer, and no interview outcome is guaranteed. Suggested answers are starting points: exact behavior can depend on your language, database, runtime, and business requirements. Validate implementation details against the official documentation for your stack.', styles['body']), PageBreak()])
    page_blocks = []
    used_height = 0
    available = H - 67 - 63 - 12
    def flush_questions():
        if page_blocks:
            story.extend([KeepTogether([item for block in page_blocks for item in block] + [PracticeNotes()]), PageBreak()])
    for i, entry in enumerate(entries):
        section, question, answer, follow = entry[:4]
        block = [Paragraph(f'{i + 1:02d} / {escape(section.upper())}', styles['section']), Paragraph(escape(question), styles['question']), Paragraph(escape(answer), styles['body'])]
        if len(entry) == 5:
            code = entry[4]
            assert all(stringWidth(line, 'Courier', 8.3) <= W - 108 for line in code.splitlines()), f"Code line too wide: {kit['id']} question {i + 1}"
            block.append(Preformatted(code, styles['code']))
        block.extend([Paragraph('<b>FOLLOW-UP</b><br/>' + escape(follow), styles['follow']), Spacer(1, 22)])
        height = sum(item.wrap(W - 108, H)[1] + item.getSpaceBefore() + item.getSpaceAfter() for item in block)
        assert height + 100 < available, f"Question too tall: {kit['id']} question {i + 1}"
        if page_blocks and (len(page_blocks) == 2 or used_height + height + 100 > available):
            flush_questions()
            page_blocks = []
            used_height = 0
        page_blocks.append(block)
        used_height += height
    flush_questions()
    story.extend([Paragraph('Your practice worksheet.', styles['heading']), Paragraph('Choose one question from each section. Practice a 60-90 second explanation, then work through the follow-up. Record the specific gap you want to revisit.', styles['body']), Spacer(1, 20)])
    for label in ['Question / topic', 'My explanation in three sentences', 'A concrete example', 'The trade-off or edge case', 'What I will revisit next']:
        story.append(Paragraph(label, styles['question']))
        for _ in range(2): story.extend([Paragraph('_' * 82, ParagraphStyle('line', fontSize=9, leading=25, textColor=colors.HexColor('#c1ceb6')))])
        story.append(Spacer(1, 10))
    dest = OUTPUT / f"{kit['id']}.pdf"
    doc = SimpleDocTemplate(str(dest), pagesize=A4, rightMargin=48, leftMargin=48, topMargin=67, bottomMargin=63, title=f"PrepTrick | {kit['title']}", author='PrepTrick', subject='Interview questions, answers, and follow-up prompts')
    doc.build(story, onFirstPage=lambda c, d, k=kit: draw_cover(c, d, k), onLaterPages=lambda c, d, k=kit: footer(c, d, k))
    reader = PdfReader(dest)
    text = '\n'.join(p.extract_text() for p in reader.pages)
    normalized = ' '.join(text.split())
    assert all(' '.join(part.split()) in normalized for q in entries for part in q[1:4]), f"Missing content in {kit['id']}"
    pdf = pdfium.PdfDocument(str(dest))
    pdf[0].render(scale=.8).to_pil().save(COVERS / f"{kit['id']}.png")
    print(f"{dest.name}: {len(entries)} questions, {len(reader.pages)} pages")
