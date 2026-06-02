from __future__ import annotations

from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT = Path(__file__).with_name(
    "Ye_Ziying_Chinese_AI_Audio_Annotation_Portfolio.pdf"
)


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("ArialUnicode", str(font_dir / "Arial Unicode.ttf")))
    pdfmetrics.registerFont(TTFont("ArialBold", str(font_dir / "Arial Bold.ttf")))


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "PortfolioTitle",
            parent=base["Title"],
            fontName="ArialBold",
            fontSize=23,
            leading=29,
            textColor=colors.HexColor("#0B2545"),
            alignment=TA_CENTER,
            spaceAfter=10,
        ),
        "subtitle": ParagraphStyle(
            "PortfolioSubtitle",
            parent=base["Normal"],
            fontName="ArialUnicode",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#3B4A5A"),
            alignment=TA_CENTER,
            spaceAfter=18,
        ),
        "h1": ParagraphStyle(
            "SectionHeading",
            parent=base["Heading1"],
            fontName="ArialUnicode",
            fontSize=14,
            leading=18,
            textColor=colors.HexColor("#1F4D78"),
            spaceBefore=14,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#182230"),
            spaceAfter=7,
        ),
        "body_cjk": ParagraphStyle(
            "BodyCjk",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#182230"),
            spaceAfter=7,
            wordWrap="CJK",
        ),
        "body_small": ParagraphStyle(
            "BodySmall",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#182230"),
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=base["BodyText"],
            fontName="ArialBold",
            fontSize=8.3,
            leading=10.5,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=7.7,
            leading=10.1,
            textColor=colors.HexColor("#182230"),
        ),
        "table_cell_cjk": ParagraphStyle(
            "TableCellCjk",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=7.7,
            leading=10.1,
            textColor=colors.HexColor("#182230"),
            wordWrap="CJK",
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=base["BodyText"],
            fontName="ArialUnicode",
            fontSize=9.3,
            leading=13,
            textColor=colors.HexColor("#25364A"),
            leftIndent=0,
            rightIndent=0,
            spaceAfter=4,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#687385"),
            alignment=TA_CENTER,
        ),
    }


def p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def bold_label(label: str, value: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(f"<b>{escape(label)}</b> {escape(value)}", style)


def table_cell(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text), style)


def section(title: str, styles: dict[str, ParagraphStyle]):
    return p(title, styles["h1"])


def bullet_list(items: list[str], styles: dict[str, ParagraphStyle]) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item, styles["body"]), leftIndent=12) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=20,
        bulletFontName="Helvetica",
        bulletFontSize=6,
    )


def add_callout(story, styles: dict[str, ParagraphStyle], rows: list[tuple[str, str]]):
    data = [[bold_label(label, value, styles["callout"])] for label, value in rows]
    tbl = Table(data, colWidths=[6.35 * inch], hAlign="LEFT")
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F6F9")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CAD5E2")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(tbl)
    story.append(Spacer(1, 0.16 * inch))


def make_schema_table(styles: dict[str, ParagraphStyle]) -> Table:
    rows = [
        ("Field", "Description"),
        ("Language", "Primary spoken language"),
        ("Chinese Variety", "Mandarin, Cantonese, Taiwanese Mandarin, Sichuan Mandarin, etc."),
        ("Speaker Count", "Number of speakers"),
        ("Accent Strength", "None / Light / Medium / Strong"),
        ("Audio Quality", "Good / Acceptable / Poor"),
        ("Background Noise", "None / Mild / Moderate / Severe"),
        ("Overlap", "None / Mild / Frequent"),
        ("Disfluency", "None / Mild / Frequent"),
        ("Emotion / Tone", "Neutral / Polite / Frustrated / Excited / Uncertain"),
        ("ASR Difficulty", "Low / Medium / High"),
        ("Training Suitability", "Suitable / Suitable with caution / Not suitable"),
    ]
    data = [
        [table_cell(cell, styles["table_header"]) for cell in rows[0]],
        *[[table_cell(a, styles["table_cell"]), table_cell(b, styles["table_cell"])] for a, b in rows[1:]],
    ]
    tbl = Table(data, colWidths=[1.65 * inch, 4.75 * inch], repeatRows=1, hAlign="LEFT")
    tbl.setStyle(common_table_style())
    return tbl


def make_annotation_table(styles: dict[str, ParagraphStyle]) -> Table:
    rows = [
        ("Time", "Speaker", "Transcript", "Annotation"),
        ("00:00-00:04", "S1", "你好，我想问一下，我昨天提交的订单，为什么现在还没有发货？", "Language: Mandarin; Accent: Light northern; Emotion: Mildly anxious; ASR Difficulty: Low"),
        ("00:04-00:07", "S2", "您好，我帮您查一下。请问订单号方便提供一下吗？", "Tone: Polite service tone; Speech rate: Normal; Audio quality: Good"),
        ("00:07-00:13", "S1", "嗯，订单号是 8273，后面应该是 19。不好意思，我这边截图有点模糊。", "Disfluency: “嗯”; Uncertainty: “应该是”; Useful for training hesitation handling"),
        ("00:13-00:18", "S2", "没关系。我这边看到订单已经付款成功，但是仓库还没有完成出库扫描。", "Domain terms: 付款成功, 出库扫描; Good for customer-service ASR"),
        ("00:18-00:23", "S1", "那大概什么时候能发？因为我周五之前要用到。", "Intent: Delivery time inquiry; Emotion: Time-sensitive but controlled"),
        ("00:23-00:29", "S2", "正常情况下今天晚上会更新物流。如果今天没有更新，建议您明天上午再联系我们。", "Clear structure; Good punctuation boundary"),
        ("00:29-00:34", "S1", "好的。那如果明天还没发，可以取消吗？", "Intent: Cancellation policy question"),
        ("00:34-00:40", "S2", "可以的。只要订单还没有出库，就可以申请取消。出库后就需要走退货流程。", "Domain distinction: 取消 vs 退货; Important semantic contrast"),
        ("00:40-00:42", "S1", "明白了，谢谢。", "Closing phrase; Low difficulty"),
    ]
    data = [
        [table_cell(cell, styles["table_header"]) for cell in rows[0]],
        *[
            [
                table_cell(time, styles["table_cell"]),
                table_cell(speaker, styles["table_cell"]),
                table_cell(transcript, styles["table_cell_cjk"]),
                table_cell(annotation, styles["table_cell"]),
            ]
            for time, speaker, transcript, annotation in rows[1:]
        ],
    ]
    tbl = Table(
        data,
        colWidths=[0.72 * inch, 0.48 * inch, 2.45 * inch, 2.75 * inch],
        repeatRows=1,
        hAlign="LEFT",
    )
    tbl.setStyle(common_table_style())
    return tbl


def common_table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4D78")),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C7D0DB")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]
    )


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#687385"))
    canvas.drawCentredString(
        LETTER[0] / 2,
        0.48 * inch,
        f"Chinese Speech Annotation & ASR Evaluation Portfolio Sample | Page {doc.page}",
    )
    canvas.restoreState()


def build_pdf() -> None:
    register_fonts()
    styles = make_styles()
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        rightMargin=0.95 * inch,
        leftMargin=0.95 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="Chinese Speech Annotation and ASR Evaluation Portfolio Sample",
        author="Ye Ziying",
    )

    story = []
    story.append(p("Chinese Speech Annotation & ASR Evaluation", styles["title"]))
    story.append(
        p(
            "中文语音标注与 ASR 评测作品样例\nPrepared for xAI AI Tutor - Chinese application",
            styles["subtitle"],
        )
    )
    add_callout(
        story,
        styles,
        [
            ("Candidate:", "Ye Ziying"),
            ("Focus:", "Mandarin Chinese audio transcription, annotation methodology, and AI data quality evaluation"),
            ("Source Note:", "Self-created simulated customer-service dialogue. No private, client, or proprietary data is included."),
            ("Audio Note:", "This annotated transcript can be paired with a short self-recorded Mandarin sample if requested."),
        ],
    )

    story.append(section("1. Task Overview / 任务说明", styles))
    story.append(
        p(
            "This sample demonstrates my ability to evaluate Chinese audio data for speech recognition and voice interaction training. "
            "The evaluation includes transcription accuracy, speaker separation, pronunciation, prosody, noise, ambiguity, and model-readiness.",
            styles["body"],
        )
    )
    story.append(
        p(
            "本样例展示我对中文语音数据进行标注与评测的能力，覆盖：转写准确性、说话人分离、发音、语调、节奏、背景噪声、歧义判断、是否适合用于模型训练等。",
            styles["body_cjk"],
        )
    )

    story.append(section("2. Annotation Schema / 标注维度", styles))
    story.append(make_schema_table(styles))

    story.append(section("3. Annotated Sample / 标注样例", styles))
    story.append(
        p(
            "Simulated scenario: a customer-service dialogue about order delivery status, cancellation eligibility, and shipment processing.",
            styles["body"],
        )
    )
    story.append(make_annotation_table(styles))

    story.append(PageBreak())
    story.append(section("4. Audio Quality Evaluation / 音频质量评估", styles))
    story.append(
        bullet_list(
            [
                "Overall Quality: Good",
                "Background Noise: Mild",
                "Speaker Overlap: None",
                "Clipping / Distortion: None",
                "Speech Rate: Normal",
                "Intelligibility: High",
                "Accent Impact: Low",
                "Recommended Use: Suitable for Mandarin ASR training, customer-service intent recognition, and dialogue-turn segmentation.",
            ],
            styles,
        )
    )

    story.append(section("5. Model Evaluation Notes / 模型评测说明", styles))
    story.append(p("If evaluating an ASR model output against this transcript, I would focus on:", styles["body"]))
    model_notes = [
        "Whether numbers such as “8273” and “19” are correctly recognized.",
        "Whether customer-service terms such as “付款成功,” “出库扫描,” and “退货流程” are preserved.",
        "Whether the model incorrectly removes meaningful hesitation markers such as “嗯” or uncertainty phrases such as “应该是.”",
        "Whether punctuation reflects the speaker’s intent and natural semantic boundaries.",
        "Whether speaker turns are separated correctly.",
    ]
    story.append(
        ListFlowable(
            [ListItem(p(item, styles["body"]), leftIndent=12) for item in model_notes],
            bulletType="1",
            leftIndent=20,
        )
    )

    story.append(section("6. Final Judgment / 最终判断", styles))
    story.append(
        p(
            "This audio is suitable for AI training and evaluation because it contains natural conversational speech, practical customer-service vocabulary, mild hesitation, clear intent shifts, and useful semantic distinctions.",
            styles["body"],
        )
    )
    story.append(
        p(
            "该样例适合用于 AI 训练与评测，因为它包含自然对话、真实客服场景词汇、轻微犹豫、明确意图变化，以及“取消”和“退货”等关键语义差异。",
            styles["body_cjk"],
        )
    )

    story.append(Spacer(1, 0.12 * inch))
    add_callout(
        story,
        styles,
        [
            ("Methodology Summary:", "I evaluate Chinese speech data by combining transcript fidelity, acoustic detail, speaker-turn logic, domain terminology, ambiguity handling, and model-readiness judgment."),
        ],
    )

    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
