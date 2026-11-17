"""Create the non-private PDF displayed in README desktop screenshots."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4

out = Path(__file__).with_name('print-guide.pdf')
c = canvas.Canvas(str(out), pagesize=A4)
c.setTitle('Print@SoC - A better print day')
c.setAuthor('Print@SoC')
W, H = A4
navy, blue, orange = '#102D46', '#2377B7', '#F2A44A'
def text(x, y, value, size=12, color=navy, bold=False):
    c.setFillColor(HexColor(color))
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.drawString(x, y, value)
def rect(x,y,w,h,color):
    c.setFillColor(HexColor(color)); c.rect(x,y,w,h,fill=1,stroke=0)
for page in (1,2):
    rect(0,0,W,H,'#F7F5EF')
    rect(0,H-286,W,286,navy)
    text(42,H-48,'PRINT@SOC  /  FIELD NOTES',11,'#B6D7EF',True)
    text(42,H-113,'A better',43,'#FFFFFF',True)
    text(42,H-164,'print day.',43,'#FFFFFF',True)
    rect(42,H-191,54,4,orange)
    text(42,H-222,'Bring your document. Check every detail.',13,'#DDEAF3')
    text(42,H-244,'Then send it to your SoC printer.',13,'#DDEAF3')
    text(42,H-332,'BEFORE YOU PRESS PRINT' if page==1 else 'AFTER YOU PRESS PRINT',11,blue,True)
    rows = [('01','Open and preview','Check the pages you actually want to print.'),('02','Choose your printer','Check its location, paper size and access.'),('03','Check both sides','Choose your binding edge and review the back.')]
    if page==2: rows=[('04','Follow the queue','Watch for queue progress and stale information.'),('05','Collect your pages','Leaving the queue does not confirm paper output.'),('06','Check before retrying','Avoid printing the same document twice.')]
    for i,(num,title,body) in enumerate(rows):
        y=H-385-i*101
        text(42,y,num,25,blue,True)
        text(101,y+3,title,17,navy,True)
        text(101,y-20,body,10.5)
        rect(101,y-40,W-143,0.7,'#D8DCE0')
    rect(42,88,W-84,56,'#E5EDF2')
    text(57,122,'PREVIEW EXAMPLE',9,blue,True)
    text(57,105,'Two A4 pages. No private data. Not a print receipt.',10)
    text(42,42,'Print@SoC  /  Sample document',9)
    text(W-76,42,f'0{page} / 02',9,blue,True)
    c.showPage()
c.save()
print(out)
