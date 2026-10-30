/** Languages offered in the app. The code is what gets stored and sent to the API. */
export const LANGS = [
  { code: "en", name: "English" },
  { code: "am", name: "አማርኛ" },
  { code: "om", name: "Afaan Oromoo" },
  { code: "ti", name: "ትግርኛ" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);

export const NAV: Record<Lang, Record<string, string>> = {
  en: {},
  am: {
    "Overview": "አጠቃላይ እይታ",
    "AI Assistant": "AI ረዳት",
    "Customers / CRM": "ደንበኞች / CRM",
    "Inventory & Sales": "ክምችትና ሽያጭ",
    "Documents": "ሰነዶች",
    "Business Intelligence": "የንግድ ትንተና",
    "Workflow Automation": "አውቶሜሽን",
    "Organizations": "ድርጅቶች",
    "Security & Audit": "ደህንነትና ኦዲት",
    "Settings": "ቅንብሮች",
    "Help & Support": "እገዛ",
  },
  om: {
    "Overview": "Ilaalcha Waliigalaa",
    "AI Assistant": "Gargaaraa AI",
    "Customers / CRM": "Maamiloota / CRM",
    "Inventory & Sales": "Kuusaa fi Gurgurtaa",
    "Documents": "Sanadoota",
    "Business Intelligence": "Beekumsa Daldalaa",
    "Workflow Automation": "Otomaatii Hojii",
    "Organizations": "Dhaabbilee",
    "Security & Audit": "Nageenya fi Sakatta'iinsa",
    "Settings": "Qindaa'ina",
    "Help & Support": "Gargaarsa",
  },
  ti: {
    "Overview": "ሓፈሻዊ ርእይቶ",
    "AI Assistant": "ሓጋዚ AI",
    "Customers / CRM": "ዓማዊል / CRM",
    "Inventory & Sales": "ዕቃን ሽያጥን",
    "Documents": "ሰነዳት",
    "Business Intelligence": "ሓበሬታ ንግዲ",
    "Workflow Automation": "ኦቶማሽን ስራሕ",
    "Organizations": "ትካላት",
    "Security & Audit": "ድሕንነትን ምርመራን",
    "Settings": "ቅያሰታት",
    "Help & Support": "ሓገዝ",
  },
};

export const UI: Record<Lang, {
  search: string; welcome: string; today: string; askPlaceholder: string;
  askAi: string; send: string; darkMode: string; language: string; logout: string;
}> = {
  en: {
    search: "Search anything...",
    welcome: "Welcome, kalu Trading PLC",
    today: "Here’s what’s happening with your business today.",
    askPlaceholder: "Ask about your business...",
    askAi: "Ask TIBEB AI",
    send: "Send",
    darkMode: "Dark mode",
    language: "Language",
    logout: "Log out",
  },
  am: {
    search: "ማንኛውንም ነገር ፈልግ...",
    welcome: "እንኳን ደህና መጡ፣ kalu Trading PLC",
    today: "ዛሬ በንግድዎ ላይ የሚሆነው ይህ ነው።",
    askPlaceholder: "ስለ ንግድዎ ይጠይቁ...",
    askAi: "KaluSmart Tradeን ይጠይቁ",
    send: "ላክ",
    darkMode: "ጨለማ ሁነታ",
    language: "ቋንቋ",
    logout: "ውጣ",
  },
  om: {
    search: "Waan kamiyyuu barbaadi...",
    welcome: "Baga nagaan dhuftan, kalu Trading PLC",
    today: "Har'a daldala keessan keessatti wanti jiru kana dha.",
    askPlaceholder: "Waa'ee daldala keessanii gaafadhaa...",
    askAi: "KaluSmart Trade gaafadhu",
    send: "Ergi",
    darkMode: "Haala dukkanaa",
    language: "Afaan",
    logout: "Ba'i",
  },
  ti: {
    search: "ዝኾነ ነገር ድለ...",
    welcome: "እንቋዕ ብደሓን መጻእኩም፣ kalu Trading PLC",
    today: "ሎሚ ኣብ ንግድካ ዘሎ ነገር እዚ እዩ።",
    askPlaceholder: "ብዛዕባ ንግድካ ሕተት...",
    askAi: "KaluSmart Trade ሕተት",
    send: "ስደድ",
    darkMode: "ጸልሚ ኩነታት",
    language: "ቋንቋ",
    logout: "ውጻእ",
  },
};


