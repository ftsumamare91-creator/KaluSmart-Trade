import type { Lang } from "./i18n";

export type AssistantText = {
  noModel: string;
  offline: string;
  tooLarge: (name: string) => string;
  cannotReach: string;
  noteLabel: string;
  checkAgain: string;
  title: string;
  subtitle: string;
  welcome: string;
  thinking: string;
  attach: string;
  camera: string;
  placeholder: string;
  question: string;
  send: string;
  disclaimer: string;
  suggestions: string[];
};

export const AI_TEXT: Record<Lang, AssistantText> = {
  en: {
    noModel: "AI model not configured yet",
    offline: "AI service is offline — start it with: uvicorn main:app --port 8000",
    tooLarge: (name) => `${name} is larger than 10 MB`,
    cannotReach: "Cannot reach the AI service. Start it with: uvicorn main:app --port 8000",
    noteLabel: "Note: ",
    checkAgain: "Check again",
    title: "KaluSmart Trade Assistant",
    subtitle: "Ask in Amharic or English · send images, files or photos",
    welcome: "Hello! Ask about your business, products or documents. You can also send a photo, a file or take a picture.",
    thinking: "Thinking…",
    attach: "Attach file",
    camera: "Camera",
    placeholder: "Ask a question…",
    question: "Question",
    send: "Send",
    disclaimer: "AI answers are informational. Verify important decisions against your business records. The assistant cannot see your sales or stock data yet.",
    suggestions: ["Summarize my business", "Which products need restocking?", "How can I improve sales?"],
  },
  am: {
    noModel: "AI ሞዴል አልተዋቀረም",
    offline: "AI አገልግሎት አይሰራም — uvicorn main:app --port 8000 ያስነሱ",
    tooLarge: (name) => `${name} ከ10 MB ይበልጣል`,
    cannotReach: "AI አገልግሎት አልተገኘም። uvicorn main:app --port 8000 ያስነሱ።",
    noteLabel: "ማስታወሻ፦ ",
    checkAgain: "እንደገና ፈትሽ",
    title: "KaluSmart Trade ረዳት",
    subtitle: "በአማርኛ ወይም በእንግሊዝኛ ይጠይቁ",
    welcome: "ሰላም! ስለ ንግድዎ፣ ምርቶችዎ ወይም ሰነዶችዎ ይጠይቁ። ፎቶ፣ ፋይል ወይም ካሜራ መላክም ይችላሉ።",
    thinking: "በማሰብ ላይ…",
    attach: "ፋይል ያያይዙ",
    camera: "ካሜራ",
    placeholder: "ጥያቄዎን ይጻፉ…",
    question: "ጥያቄ",
    send: "ላክ",
    disclaimer: "የAI መልሶች መረጃ ሰጪ ናቸው። ውሳኔ ከመስጠትዎ በፊት በንግድ መዝገቦችዎ ያረጋግጡ።",
    suggestions: ["ንግዴን በአጭሩ ጠቅልለው", "የትኞቹ ምርቶች መሞላት አለባቸው?", "ሽያጬን እንዴት ማሳደግ እችላለሁ?"],
  },
  om: {
    noModel: "Moodelli AI hin qindaa'in",
    offline: "Tajaajilli AI hin hojjetu — uvicorn main:app --port 8000 jalqabi",
    tooLarge: (name) => `${name} 10 MB caala`,
    cannotReach: "Tajaajilli AI hin argamne. uvicorn main:app --port 8000 jalqabi.",
    noteLabel: "Yaadachiisa: ",
    checkAgain: "Deebi'ii ilaali",
    title: "Gargaaraa KaluSmart Trade",
    subtitle: "Afaan Oromoo, Amaaraa ykn Ingiliizii gaafadhu · suuraa, faayilii ykn fakkii ergi",
    welcome: "Akkam! Waa'ee daldala, meeshaalee ykn dokumentii keessan gaafadhaa. Suuraa, faayilii ykn fakkii kaasuunis ni danda'ama.",
    thinking: "Yaadaa jira…",
    attach: "Faayilii maxxansi",
    camera: "Kaameraa",
    placeholder: "Gaaffii kee barreessi…",
    question: "Gaaffii",
    send: "Ergi",
    disclaimer: "Deebiwwan AI odeeffannoo qofa dha. Murtii guddaa dura galmee daldala keessaniitti mirkaneeffadhu.",
    suggestions: ["Daldala koo cuunfaadhaa", "Meeshaalee haaromsuu barbaadan maali?", "Gurgurtaa akkamitti guddisuu danda'a?"],
  },
  ti: {
    noModel: "ሞዴል AI ኣይተሰነየን",
    offline: "ኣገልግሎት AI ኣይሰርሕን — uvicorn main:app --port 8000 ኣንቅሖ",
    tooLarge: (name) => `${name} ካብ 10 MB ዝዓበየ እዩ`,
    cannotReach: "ኣገልግሎት AI ኣይተረኽበን። uvicorn main:app --port 8000 ኣንቅሖ።",
    noteLabel: "ማስታወሻ፦ ",
    checkAgain: "ደጊምካ ፈትሽ",
    title: "ሓጋዚ KaluSmart Trade",
    subtitle: "ብትግርኛ ወይ ብእንግሊዝኛ ሕተት · ስእልታት፣ ፋይላትን ፎቶታትን ስደድ",
    welcome: "ሰላም! ብዛዕባ ንግድካ፣ ዕቃታትካ ወይ ሰነዳትካ ሕተት። ፎቶ፣ ፋይል ወይ ካሜራ ድማ ክትሰድድ ትኽእል ኢኻ።",
    thinking: "ኣሐሳብ ይገብር ኣሎ…",
    attach: "ፋይል ኣያይዝ",
    camera: "ካሜራ",
    placeholder: "ሕቶኻ ጽሓፍ…",
    question: "ሕቶ",
    send: "ስደድ",
    disclaimer: "መልስታት AI ሓበሬታዊ ጥራይ እዮም። ኣብ መዝገብ ንግድካ ኣረጋግጽ።",
    suggestions: ["ንግዴ ብሓጺሩ ጠቅልል", "ኣየን ዕቃታት ክሰርሕ ዝግብኦም?", "ሽያጥካ ብኸመይ ክትመዓይ ትኽእል?"],
  },
};
