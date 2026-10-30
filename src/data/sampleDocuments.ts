import { PdfPageContent, SampleDocumentPreset, VoicePersona } from "../types";

export const VOICE_PERSONAS: VoicePersona[] = [
  {
    id: "Kore",
    name: "Kore",
    timbre: "Warm · Articulate Alto",
    bestFor: "Long-form research papers, healthcare forms, and calm study sessions",
    sampleLine:
      "Welcome to Free PDF AI. I read dense research papers and clinical documents at a calm, unhurried pace with clear emphasis on headings and figures.",
    stylePrompt: "Warm, articulate, calm accessibility narrator with clear enunciation of headings and numbers",
  },
  {
    id: "Charon",
    name: "Charon",
    timbre: "Measured · Deep Baritone",
    bestFor: "Legal contracts, municipal policies, and financial disclosures",
    sampleLine:
      "Section Three outlines your tenant renewal rights, including a sixty-day notice requirement before any adjustment takes effect.",
    stylePrompt: "Measured, steady, reassuring baritone narrator with crisp diction",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    timbre: "Bright · Crisp Midrange",
    bestFor: "Course syllabi, executive briefs, and daily reading queues",
    sampleLine:
      "Here are the four core findings from today's transit accessibility audit, starting with tactile platform upgrades.",
    stylePrompt: "Bright, clear, friendly contemporary reader with natural cadence",
  },
  {
    id: "Puck",
    name: "Puck",
    timbre: "Expressive · Conversational",
    bestFor: "Plain-language guides and ADHD-friendly auditory summaries",
    sampleLine:
      "Let's break this clinical consent form into plain English so you know what happens at each visit before you sign.",
    stylePrompt: "Engaging, conversational, supportive explainer voice",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    timbre: "Resonant · Studio Documentary",
    bestFor: "Historical archives, whitepapers, and technical manuals",
    sampleLine:
      "Across twelve metropolitan rail corridors, acoustic wayfinding beacons reduced transfer navigation time by forty-one percent.",
    stylePrompt: "Resonant documentary narrator with steady authority and clarity",
  },
];

function splitRawTextIntoPages(rawText: string): PdfPageContent[] {
  const sections = rawText
    .split(/\n(?=\d+\.\s|[A-Z][A-Z\s&()-]{6,}\n)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return sections.map((sec, idx) => {
    const firstNewline = sec.indexOf("\n");
    const heading =
      firstNewline > 0 ? sec.slice(0, firstNewline).trim() : `Page ${idx + 1}`;
    return {
      pageNumber: idx + 1,
      heading,
      text: sec,
    };
  });
}

export const SAMPLE_DOCUMENTS: SampleDocumentPreset[] = [
  {
    id: "transit-accessibility-2026",
    title: "2026 Municipal Rail & Bus Audio Wayfinding Plan",
    category: "Public Policy PDF",
    fileName: "Metro_Audio_Wayfinding_Plan_2026.pdf",
    fileSizeLabel: "1.8 MB",
    pages: 14,
    rawText: `METROPOLITAN TRANSIT AUTHORITY — 2026 UNIVERSAL AUDIO & TACTILE WAYFINDING IMPLEMENTATION PLAN
Publication Date: October 2026 | Document ID: MTA-ACC-2026-09

1. EXECUTIVE PURPOSE
Beginning January 15, 2027, the Metropolitan Transit Authority (MTA) will deploy ultra-wideband Bluetooth acoustic beacons and standardized braille-tactile faregate modules across all 68 rail stations and 310 rapid-bus shelters. Public feedback remains open through November 30, 2026 via phone hotline (800-555-0194) or accessible web portal.

2. CAPITAL BUDGET & DEPLOYMENT SCHEDULE (TABLE 1)
- Phase 1 (Q1 2027): 24 Downtown Transfer Stations — $4.2M allocated — 100% elevator status voice announcements & high-contrast platform edge LEDs.
- Phase 2 (Q2–Q3 2027): 44 Neighborhood Rail Stations — $6.8M allocated — Directional spatial audio beacons at escalators, faregates, and emergency intercoms.
- Phase 3 (Q4 2027): 310 Rapid-Bus Shelters — $3.1M allocated — Push-to-hear solar arrival readers and automatic onboard next-stop induction loop audio.
Total Funded Budget: $14.1 Million (fully funded via Federal Transit Accessibility Grant FTA-884).

3. MEASURED PILOT OUTCOMES (FIGURE 2 BAR CHART)
During the 6-month Civic Center & Union Station pilot involving 185 blind, low-vision, and deafblind commuters:
- Average unassisted platform transfer time dropped from 7.4 minutes to 4.3 minutes (-41.9%).
- Missed bus connections at multi-bay terminals fell from 18% to 3%.
- 94% of screen-reader riders rated bone-conduction headphone beacon prompts "clear in peak crowd noise" (82 dB ambient).

4. RIDER ACTION ITEMS & REDUCED-FARE ACCESSIBILITY CARD
Eligible riders with visual, auditory, mobility, or cognitive print disabilities may request a free Tactile SmartTap Card starting December 1, 2026. Existing Reduced-Fare ID holders are automatically enrolled without re-certification.`,
    initialAnalysis: {
      documentTitle: "2026 Municipal Rail & Bus Audio Wayfinding Plan",
      fileName: "Metro_Audio_Wayfinding_Plan_2026.pdf",
      fileSizeLabel: "1.8 MB",
      detectedPageCountEstimate: 4,
      readingLevel: "Clear Executive Prose",
      estimatedListenSeconds: 105,
      overview:
        "The Metropolitan Transit Authority is rolling out spatial audio beacons, push-to-hear bus arrival readers, and tactile faregates across 68 rail stations and 310 bus shelters starting January 15, 2027. Public comments close November 30, 2026, and existing reduced-fare riders receive automatic enrollment.",
      narrationScript:
        "Here is your accessible audio summary of the 2026 Municipal Rail and Bus Audio Wayfinding Plan. Starting January fifteenth, twenty twenty-seven, the Metropolitan Transit Authority will equip all sixty-eight rail stations and three hundred ten rapid-bus shelters with spatial audio beacons and tactile braille faregates. The fourteen point one million dollar program rolls out in three phases across twenty twenty-seven. Phase One upgrades twenty-four downtown transfer hubs in the first quarter, adding spoken elevator status alerts and high-contrast platform lighting. Phase Two expands directional audio beacons to forty-four neighborhood rail stations by autumn. Phase Three installs solar push-to-hear arrival buttons at three hundred ten bus shelters by year end. In six-month pilot testing with one hundred eighty-five blind and low-vision riders, unassisted transfer times dropped by nearly forty-two percent, from seven point four minutes down to four point three minutes, and missed multi-bay bus connections fell from eighteen percent to just three percent. If you already hold a Reduced-Fare ID, you will be enrolled automatically for the new Tactile SmartTap Card on December first without extra paperwork. Public feedback is open through November thirtieth by phone or online.",
      dialogueTurns: [
        {
          speaker: "Alex",
          text: "Today we're reviewing the 2026 Municipal Rail and Bus Audio Wayfinding Plan, a roadmap for accessible transit upgrades starting January 15, 2027.",
          style: "Warm, articulate lead narrator",
        },
        {
          speaker: "Sam",
          text: "What changes will blind and low-vision commuters actually notice first when they walk into a station?",
          style: "Curious, clear conversational co-host",
        },
        {
          speaker: "Alex",
          text: "In the first quarter of 2027, all 24 downtown transfer stations get live spoken elevator status alerts, braille faregate modules, and spatial audio beacons that guide riders straight to stairs and platforms.",
          style: "Warm, articulate lead narrator",
        },
        {
          speaker: "Sam",
          text: "Did they test how well those audio prompts hold up inside noisy rush-hour stations?",
          style: "Curious, clear conversational co-host",
        },
        {
          speaker: "Alex",
          text: "They did. In a six-month pilot with 185 commuters at Union Station, 94 percent rated the prompts clear even in 82-decibel crowd noise, and transfer times dropped by 42 percent.",
          style: "Warm, articulate lead narrator",
        },
        {
          speaker: "Sam",
          text: "And if someone needs the new Tactile SmartTap Card or wants to submit feedback, what are the key dates?",
          style: "Curious, clear conversational co-host",
        },
        {
          speaker: "Alex",
          text: "Public comments close November 30, 2026, and free Tactile SmartTap Cards open December 1—with automatic enrollment if you already have a Reduced-Fare ID.",
          style: "Warm, articulate lead narrator",
        },
      ],
      chapters: [
        {
          id: "ch-1",
          title: "01. Rollout Mandate & Public Comment Window",
          summary: "Covers the January 15, 2027 launch across 68 rail stations and the November 30 feedback deadline.",
          spokenText:
            "Chapter One: Rollout Mandate and Public Comment Window. Beginning January fifteenth, twenty twenty-seven, the Transit Authority will install Bluetooth acoustic wayfinding beacons and braille-tactile faregates across sixty-eight rail stations and three hundred ten bus shelters. Riders can submit comments until November thirtieth via the accessible portal or toll-free hotline.",
          keyFacts: [
            "68 rail stations and 310 rapid-bus shelters covered",
            "Public comment deadline: November 30, 2026",
          ],
        },
        {
          id: "ch-2",
          title: "02. Three-Phase Budget & Station Schedule",
          summary: "Breaks down the $14.1M federal grant across Q1 downtown hubs, Q2–Q3 neighborhood rail, and Q4 bus shelters.",
          spokenText:
            "Chapter Two: Three-Phase Budget and Station Schedule. Total funding is fourteen point one million dollars under Federal Grant FTA eight-eight-four. Phase One invests four point two million dollars in twenty-four downtown hubs in quarter one. Phase Two allocates six point eight million for forty-four neighborhood stations, and Phase Three dedicates three point one million for solar push-to-hear bus shelter readers in quarter four.",
          keyFacts: [
            "$14.1M fully funded via Federal Grant FTA-884",
            "Q1: Downtown hubs · Q2–Q3: Neighborhood rail · Q4: Bus shelters",
          ],
        },
        {
          id: "ch-3",
          title: "03. Civic Center Pilot Performance Data",
          summary: "Summarizes findings from 185 blind, low-vision, and deafblind commuters during six months of testing.",
          spokenText:
            "Chapter Three: Civic Center Pilot Performance Data. Over six months with one hundred eighty-five blind, low-vision, and deafblind riders, average platform transfer times fell from seven point four minutes to four point three minutes. Missed bus connections dropped from eighteen percent to three percent.",
          keyFacts: [
            "41.9% faster unassisted platform transfers",
            "Missed bus connections reduced from 18% to 3%",
          ],
        },
        {
          id: "ch-4",
          title: "04. Tactile SmartTap Card Enrollment",
          summary: "Explains eligibility and automatic enrollment starting December 1, 2026.",
          spokenText:
            "Chapter Four: Tactile SmartTap Card Enrollment. Riders with visual, auditory, mobility, or print disabilities can request a free Tactile SmartTap Card starting December first, twenty twenty-six. Current Reduced-Fare cardholders are enrolled automatically without re-applying.",
          keyFacts: [
            "Free Tactile SmartTap Card opens December 1, 2026",
            "Zero re-certification required for current Reduced-Fare holders",
          ],
        },
      ],
      visualDescriptions: [
        {
          label: "Table 1 — 2027 Capital Allocation & Quarterly Milestones",
          elementType: "Data Table",
          spokenDescription:
            "A four-column schedule table comparing deployment phases. Row 1 lists Phase 1 in Quarter 1 2027 covering 24 Downtown Transfer Stations at 4.2 million dollars. Row 2 lists Phase 2 in Quarters 2 through 3 covering 44 Neighborhood Stations at 6.8 million dollars. Row 3 lists Phase 3 in Quarter 4 covering 310 Rapid-Bus Shelters at 3.1 million dollars, summing to 14.1 million dollars.",
        },
        {
          label: "Figure 2 — Pilot Navigation Time & Missed Connection Comparison",
          elementType: "Paired Bar Chart",
          spokenDescription:
            "A paired horizontal bar chart comparing commuter outcomes before and after audio beacon installation among 185 testers. Unassisted transfer duration shrinks from 7.4 minutes pre-pilot to 4.3 minutes post-pilot, while missed multi-bay bus transfers drop sharply from 18 percent down to 3 percent.",
        },
      ],
      keyTakeaways: [
        "All 68 rail stations and 310 rapid-bus shelters gain audio beacons across Q1–Q4 2027 ($14.1M funded).",
        "Pilot testing with 185 commuters cut platform transfer time by 41.9% (7.4 min to 4.3 min).",
        "Public feedback closes November 30, 2026 via hotline 800-555-0194 or web portal.",
        "Free Tactile SmartTap Cards launch December 1, 2026 with automatic enrollment for Reduced-Fare ID holders.",
      ],
      suggestedQuestions: [
        "Read Page 2 on the budget and deployment schedule out loud.",
        "Do I need to re-apply if I already have a Reduced-Fare ID?",
        "How did the beacons perform in loud rush-hour crowd noise?",
        "What is the phone hotline number for public feedback?",
      ],
      language: "English",
      modelUsed: "gemini-3.8-flash",
      rawExcerpt: "",
    },
  },
  {
    id: "clinical-consent-brief",
    title: "Clinical Trial Patient Informed Consent Form (LUMINA-3)",
    category: "Healthcare Form",
    fileName: "LUMINA3_Ophthalmology_Consent_Form.pdf",
    fileSizeLabel: "940 KB",
    pages: 9,
    rawText: `PATIENT INFORMED CONSENT DOCUMENT — PROTOCOL LUMINA-3
Study Title: Twice-Yearly Sustained-Release Retinal Drop vs. Monthly Clinic Evaluation in Early Macular Degeneration
Principal Investigator: Dr. Marcus Vance, MD | St. Jude Vision Institute

1. WHY IS THIS STUDY BEING DONE?
You are invited to participate in a 12-month voluntary clinical research study evaluating whether a preservative-free home eye drop taken twice daily can stabilize macular pigment density as effectively as standard bi-monthly in-clinic optical monitoring.

2. VISIT SCHEDULE & TIME COMMITMENT (TABLE A)
- Screening Visit (Week 0): 90 minutes — Non-invasive retinal scan (OCT), visual acuity reading chart, blood pressure check. No pupil-dilating drops required.
- Follow-Up Visits (Months 3, 6, 9, and 12): 45 minutes each — Contrast sensitivity check and bottle refill.
- Home Routine: 1 drop in the study eye at 8:00 AM and 8:00 PM daily. Bottle caps include raised tactile ridges (1 ridge for morning, 2 ridges for evening) and audible click counters.

3. RISKS & SIDE EFFECTS
In Phase 2 testing (412 adults), mild temporary eye dryness occurred in 9% of participants (resolved within 10 minutes), mild morning glare in 4%, and serious adverse events in 0.2%. You may pause drops and reach the 24-hour nurse line at any time.

4. COSTS, STIPEND & VOLUNTARY WITHDRAWAL
All study medications, accessible rideshare transport to and from clinic visits, and exams are provided at $0 cost to you or your insurer. Participants receive a $65 stipend per completed clinic visit ($325 total across 5 visits). You may leave the study at any moment without affecting your regular eye care.`,
    initialAnalysis: {
      documentTitle: "Clinical Trial Patient Informed Consent Form (LUMINA-3)",
      fileName: "LUMINA3_Ophthalmology_Consent_Form.pdf",
      fileSizeLabel: "940 KB",
      detectedPageCountEstimate: 4,
      readingLevel: "Grade 7 Patient Accessible",
      estimatedListenSeconds: 95,
      overview:
        "This consent form explains LUMINA-3, a voluntary 12-month study testing twice-daily home eye drops for early macular degeneration at St. Jude Vision Institute. All exams, drops, and accessible rideshare trips are free, and participants receive $65 per visit across five clinic appointments.",
      narrationScript:
        "This audio guide summarizes the LUMINA-3 Patient Informed Consent Form from St. Jude Vision Institute. Participation is completely voluntary, and you can leave at any time without affecting your regular medical care. The twelve-month study tests whether a preservative-free eye drop used at home twice a day supports early macular health. If you join, you will attend five clinic visits in total: one ninety-minute screening visit at the start, followed by four forty-five-minute checkups at months three, six, nine, and twelve. None of the retinal scans require pupil-dilating drops. At home, you place one drop at eight A.M. and one drop at eight P.M. To prevent mix-ups for low-vision participants, the morning bottle cap has one raised tactile ridge, the evening cap has two ridges, and each cap clicks audibly when dispensed. In earlier testing with four hundred twelve adults, nine percent experienced brief mild dryness lasting under ten minutes, and four percent noted mild morning glare. All exams, drops, and round-trip accessible rideshare transportation cost zero dollars, and you receive sixty-five dollars per visit, totaling three hundred twenty-five dollars.",
      dialogueTurns: [
        {
          speaker: "Alex",
          text: "Let's walk through the LUMINA-3 Informed Consent Form in plain English before you decide whether to sign.",
          style: "Warm, reassuring narrator",
        },
        {
          speaker: "Sam",
          text: "First off, what is the daily routine if someone joins, and how are the bottles designed for low vision?",
          style: "Curious, supportive co-host",
        },
        {
          speaker: "Alex",
          text: "You use one preservative-free drop at 8 AM and one at 8 PM. The morning bottle cap has one raised tactile ridge, the evening cap has two ridges, and the cap makes an audible click so you know a drop dispensed.",
          style: "Warm, reassuring narrator",
        },
        {
          speaker: "Sam",
          text: "How many clinic trips are involved, and do they dilate your eyes at every appointment?",
          style: "Curious, supportive co-host",
        },
        {
          speaker: "Alex",
          text: "There are five visits over 12 months—one 90-minute screening and four 45-minute checkups—with zero pupil-dilating drops needed, plus free round-trip rideshare transport and a $65 stipend per visit.",
          style: "Warm, reassuring narrator",
        },
      ],
      chapters: [
        {
          id: "c1",
          title: "01. Study Purpose & Voluntary Rights",
          summary: "Explains the 12-month home eye drop evaluation and unconditional right to withdraw.",
          spokenText:
            "Chapter One: Study Purpose and Voluntary Rights. LUMINA-3 evaluates a twice-daily home eye drop for early macular degeneration over twelve months. Joining is strictly voluntary, and stopping at any point never alters your standard care.",
          keyFacts: ["12-month voluntary study", "Withdraw anytime with zero penalty"],
        },
        {
          id: "c2",
          title: "02. Clinic Visits & Tactile Bottle Design",
          summary: "Details the 5 non-dilating clinic visits and tactile morning/evening bottle ridges.",
          spokenText:
            "Chapter Two: Clinic Visits and Tactile Bottle Design. You attend one ninety-minute screening and four forty-five-minute checkups at months three, six, nine, and twelve without pupil dilation. Home bottles use one tactile ridge for morning and two ridges for evening.",
          keyFacts: ["No pupil dilation required", "1 ridge = 8 AM cap · 2 ridges = 8 PM cap"],
        },
        {
          id: "c3",
          title: "03. Side Effects, Rideshare & $325 Stipend",
          summary: "Covers Phase 2 safety rates, zero out-of-pocket cost, free rideshare, and $65 per visit compensation.",
          spokenText:
            "Chapter Three: Side Effects, Rideshare, and Stipend. Mild ten-minute dryness occurred in nine percent of prior participants. Study care and accessible rideshares are free, and each of the five visits pays a sixty-five dollar stipend.",
          keyFacts: ["9% brief mild dryness, 4% mild glare", "Free rideshare + $65 per visit ($325 total)"],
        },
      ],
      visualDescriptions: [
        {
          label: "Table A — Participant Visit Timeline & Procedures",
          elementType: "Schedule Table",
          spokenDescription:
            "A five-row clinic calendar showing Week 0 Screening at 90 minutes, followed by Month 3, Month 6, Month 9, and Month 12 checkups at 45 minutes each. Every row notes non-dilating OCT imaging and a $65 stipend payout.",
        },
        {
          label: "Diagram 1 — Tactile Dropper Cap Identification",
          elementType: "Product Illustration",
          spokenDescription:
            "Side-by-side line diagram of two eye-dropper caps: the left cap features a single raised horizontal ring for the 8:00 AM dose; the right cap features two parallel raised rings for the 8:00 PM dose, plus an acoustic click collar at the base.",
        },
      ],
      keyTakeaways: [
        "5 total clinic visits over 12 months; no pupil-dilating drops required.",
        "Bottles feature raised tactile ridges (1 morning, 2 evening) and audible dose clicks.",
        "Mild 10-minute dryness reported in 9% of Phase 2 participants; 24/7 nurse line included.",
        "$0 cost, free round-trip accessible rideshare, and $65 stipend per visit ($325 total).",
      ],
      suggestedQuestions: [
        "Read the Risks and Side Effects section out loud to me.",
        "How can I tell the morning and evening eye-drop bottles apart by touch?",
        "Who is the Principal Investigator running this study?",
        "Is transportation to St. Jude Vision Institute covered?",
      ],
      language: "English",
      modelUsed: "gemini-3.8-flash",
      rawExcerpt: "",
    },
  },
  {
    id: "cognitive-ergonomics-paper",
    title: "Auditory Chaptering & Print Fatigue in Higher Education",
    category: "Academic Paper",
    fileName: "Journal_Cognitive_Ergonomics_Vol42.pdf",
    fileSizeLabel: "2.6 MB",
    pages: 22,
    rawText: `JOURNAL OF COGNITIVE ERGONOMICS & ACCESSIBLE MEDIA — VOL. 42, ISSUE 4 (2026)
Title: Structured Prosodic Audio Summaries vs. Monotone Synthetic Screen Readers in Graduate Literature Review
Authors: Dr. Elena Rostova, Dr. Kenji Takahashi, & Priya Nair (University Consortium for Inclusive Design)

1. ABSTRACT & METHODOLOGY
Graduate students with dyslexia, ADHD, post-concussion visual fatigue, and low vision routinely review 250+ pages of multi-column PDFs weekly. Traditional OCR screen readers read running headers, page numbers, footnote URLs, and raw table cells verbatim, increasing cognitive load. Across 140 graduate researchers over 8 weeks, we compared three conditions: (A) raw linear TTS, (B) single-voice prosodic chaptered summaries with verbalized figure descriptions, and (C) dual-speaker conversational audio briefs.

2. RESULTS SUMMARY (TABLE 3 & FIGURE 4)
- Factual Retention at 7 Days: 54% in Condition A (raw linear TTS), 79% in Condition B (prosodic chaptered summary), and 83% in Condition C (dual-speaker dialogue).
- Perceived Eye & Mental Fatigue (NASA-TLX Scale, lower is better): 74.2 in Condition A vs. 36.8 in Condition B (-50.4% cognitive strain).
- Literature Triage Speed: Researchers identified relevant methodology sections 3.4x faster when multi-column PDFs were pre-segmented into semantic spoken chapters with verbal chart summaries.`,
    initialAnalysis: {
      documentTitle: "Auditory Chaptering & Print Fatigue in Higher Education",
      fileName: "Journal_Cognitive_Ergonomics_Vol42.pdf",
      fileSizeLabel: "2.6 MB",
      detectedPageCountEstimate: 3,
      readingLevel: "Accessible Academic Synthesis",
      estimatedListenSeconds: 90,
      overview:
        "This study of 140 graduate researchers compares raw screen-reader output against structured, prosodic audio summaries and dual-speaker dialogues. Semantic chaptering and verbalized chart descriptions cut mental fatigue in half and boosted seven-day factual retention from 54% to up to 83%.",
      narrationScript:
        "Here is the audio synthesis of Auditory Chaptering and Print Fatigue in Higher Education, published in Volume Forty-Two of the Journal of Cognitive Ergonomics. Researchers followed one hundred forty graduate students with dyslexia, ADHD, low vision, and post-concussion visual fatigue over eight weeks as they reviewed dense multi-column PDFs. Standard linear text-to-speech tools often read running page headers, raw URLs, and unformatted table cells out loud, draining working memory. When documents were converted into structured prosodic audio chapters with spoken chart descriptions, mental workload on the NASA Task Load scale dropped by fifty point four percent, falling from seventy-four point two down to thirty-six point eight. Seven-day factual retention climbed from fifty-four percent with raw text-to-speech to seventy-nine percent with single-voice chaptered summaries, and reached eighty-three percent with two-host conversational audio. Overall, researchers triaged academic papers three point four times faster.",
      dialogueTurns: [
        {
          speaker: "Alex",
          text: "This study asks why traditional screen readers can feel exhausting on academic PDFs—and what actually fixes it.",
          style: "Warm, articulate lead narrator",
        },
        {
          speaker: "Sam",
          text: "Anyone who has listened to a PDF read page numbers and broken URLs mid-sentence knows that frustration. What did they test instead?",
          style: "Curious, clear conversational co-host",
        },
        {
          speaker: "Alex",
          text: "With 140 graduate researchers over eight weeks, they compared raw linear TTS against chaptered prosodic summaries with spoken chart descriptions, plus two-host dialogue briefs.",
          style: "Warm, articulate lead narrator",
        },
        {
          speaker: "Sam",
          text: "How big was the difference in memory retention and mental fatigue?",
          style: "Curious, clear conversational co-host",
        },
        {
          speaker: "Alex",
          text: "Cognitive fatigue dropped by slightly over 50 percent, seven-day retention jumped from 54 percent to 83 percent in dialogue mode, and literature review moved 3.4 times faster.",
          style: "Warm, articulate lead narrator",
        },
      ],
      chapters: [
        {
          id: "p1",
          title: "01. Why Linear PDF Screen Reading Drains Working Memory",
          summary: "Examines multi-column OCR artifacts, footnote interruptions, and raw table cell reading.",
          spokenText:
            "Chapter One: Why Linear PDF Screen Reading Drains Working Memory. Graduate students reading over two hundred fifty pages weekly face severe cognitive friction when linear screen readers interrupt sentences with running headers, DOIs, and raw table coordinates.",
          keyFacts: ["250+ weekly PDF pages per graduate researcher", "Header/URL interruptions fragment comprehension"],
        },
        {
          id: "p2",
          title: "02. 8-Week Study Outcomes Across 140 Researchers",
          summary: "Compares retention (54% vs 79% vs 83%) and NASA-TLX workload scores (-50.4%).",
          spokenText:
            "Chapter Two: Eight-Week Study Outcomes. Across one hundred forty participants, seven-day recall rose from fifty-four percent in raw linear TTS to seventy-nine percent in chaptered single-voice audio and eighty-three percent in dual-host dialogue, while NASA-TLX fatigue fell by fifty percent.",
          keyFacts: ["83% 7-day retention in dual-speaker mode", "3.4x faster methodology triage"],
        },
      ],
      visualDescriptions: [
        {
          label: "Table 3 — Retention & NASA-TLX Cognitive Load by Audio Format",
          elementType: "Comparison Table",
          spokenDescription:
            "Three-row experimental results table across 140 participants: Raw Linear TTS scored 54% 7-day retention and 74.2 fatigue; Prosodic Chaptered Audio scored 79% retention and 36.8 fatigue; Dual-Speaker Dialogue scored 83% retention and 34.9 fatigue.",
        },
      ],
      keyTakeaways: [
        "Prosodic chaptered audio cut mental fatigue by 50.4% on the NASA-TLX workload scale.",
        "7-day factual retention increased from 54% (raw TTS) to 79% (chaptered) and 83% (dual-host dialogue).",
        "Verbalized chart and table summaries accelerated literature triage by 3.4x across 140 researchers.",
      ],
      suggestedQuestions: [
        "Read the Results Summary section of this paper aloud.",
        "Who are the three authors of this study?",
        "How much did seven-day retention improve with dual-speaker dialogue?",
        "What does the NASA-TLX fatigue score show?",
      ],
      language: "English",
      modelUsed: "gemini-3.8-flash",
      rawExcerpt: "",
    },
  },
];

for (const doc of SAMPLE_DOCUMENTS) {
  doc.initialAnalysis.rawExcerpt = doc.rawText;
  doc.initialAnalysis.pages = splitRawTextIntoPages(doc.rawText);
  doc.initialAnalysis.detectedPageCountEstimate =
    doc.initialAnalysis.pages.length;
  const words = doc.rawText.trim().split(/\s+/).filter(Boolean).length;
  const lines = doc.rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
  doc.initialAnalysis.totalWordsRead = words;
  doc.initialAnalysis.totalLinesRead = lines;
  doc.initialAnalysis.detailedReport = `${doc.initialAnalysis.overview}\n\nPage-by-Page Breakdown (${doc.initialAnalysis.pages.length} sections, ${lines} lines, ${words} words read):\n${doc.initialAnalysis.pages
    .map((p) => `• Page ${p.pageNumber} (${p.heading}): ${p.text.replace(/\s+/g, " ").trim()}`)
    .join("\n\n")}`;
}
