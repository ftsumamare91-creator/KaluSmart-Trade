/**
 * Seeds the starter category tree for every organization that has no categories yet.
 * Safe to re-run: organizations that already have categories are skipped.
 * Run with: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';

interface CategorySeed {
  slug: string;
  am: string;
  en: string;
  children?: CategorySeed[];
}

const CATALOG: CategorySeed[] = [
  { slug: 'clothing', am: 'ልብሶች', en: 'Clothing', children: [
    { slug: 'traditional-clothing', am: 'ባህላዊ', en: 'Traditional', children: [
      { slug: 'netela', am: 'ነጠላ', en: 'Netela (traditional shawl)' },
      { slug: 'gabi', am: 'ጋቢ', en: 'Gabi (traditional cloak)' },
      { slug: 'traditional-dress', am: 'የባህል ቀሚስ', en: 'Traditional dress' },
      { slug: 'traditional-trousers', am: 'የባህል ሱሪ', en: 'Traditional trousers' },
    ] },
    { slug: 'modern-clothing', am: 'ዘመናዊ', en: 'Modern' },
    { slug: 'mens-clothing', am: 'የወንዶች', en: "Men's" },
    { slug: 'womens-clothing', am: 'የሴቶች', en: "Women's" },
    { slug: 'kids-clothing', am: 'የልጆች', en: "Children's" },
    { slug: 'work-clothing', am: 'የሥራ ልብሶች', en: 'Work wear' },
  ] },
  { slug: 'electronics', am: 'ኤሌክትሮኒክስ', en: 'Electronics', children: [
    { slug: 'phones', am: 'ስልኮች', en: 'Phones' },
    { slug: 'laptops', am: 'ላፕቶፖች', en: 'Laptops' },
    { slug: 'desktops', am: 'ዴስክቶፖች', en: 'Desktop computers' },
    { slug: 'televisions', am: 'ቴሌቪዥኖች', en: 'Televisions' },
    { slug: 'smart-watches', am: 'ስማርት ሰዓቶች', en: 'Smart watches' },
    { slug: 'cameras', am: 'ካሜራዎች', en: 'Cameras' },
  ] },
  { slug: 'kids-items', am: 'የልጆች ዕቃዎች', en: "Children's items", children: [
    { slug: 'toys', am: 'መጫወቻዎች', en: 'Toys' },
    { slug: 'educational-items', am: 'የትምህርት ዕቃዎች', en: 'Educational items' },
    { slug: 'childcare', am: 'የሕፃናት እንክብካቤ', en: 'Childcare' },
  ] },
  { slug: 'shoes', am: 'ጫማዎች', en: 'Shoes', children: [
    { slug: 'traditional-shoes', am: 'ባህላዊ', en: 'Traditional' },
    { slug: 'modern-shoes', am: 'ዘመናዊ', en: 'Modern' },
    { slug: 'sports-shoes', am: 'የስፖርት', en: 'Sports' },
    { slug: 'work-shoes', am: 'የሥራ', en: 'Work' },
    { slug: 'kids-shoes', am: 'የሕፃናት', en: 'Children' },
  ] },
  { slug: 'sports-equipment', am: 'የስፖርት ዕቃዎች', en: 'Sports equipment', children: [
    { slug: 'football', am: 'የእግር ኳስ', en: 'Football' },
    { slug: 'athletics', am: 'የአትሌቲክስ', en: 'Athletics' },
    { slug: 'gym', am: 'የጂም', en: 'Gym' },
    { slug: 'cycling', am: 'የብስክሌት', en: 'Cycling' },
  ] },
  { slug: 'cosmetics', am: 'ኮስሞቲክስ', en: 'Cosmetics', children: [
    { slug: 'skin-care', am: 'የቆዳ እንክብካቤ', en: 'Skin care' },
    { slug: 'hair-products', am: 'የፀጉር ዕቃዎች', en: 'Hair products' },
    { slug: 'perfume', am: 'ሽቶ', en: 'Perfume' },
    { slug: 'makeup', am: 'ሜካፕ', en: 'Makeup' },
  ] },
  { slug: 'jewelry-gifts', am: 'ጌጣጌጥና ስጦታ', en: 'Jewelry and gifts', children: [
    { slug: 'watches', am: 'ሰዓቶች', en: 'Watches' },
    { slug: 'rings', am: 'ቀለበቶች', en: 'Rings' },
    { slug: 'bracelets', am: 'ሐብሎች', en: 'Bracelets' },
    { slug: 'gift-items', am: 'የስጦታ ዕቃዎች', en: 'Gift items' },
  ] },
  { slug: 'car-parts', am: 'የመኪና መለዋወጫ', en: 'Car spare parts', children: [
    { slug: 'brake-parts', am: 'የብሬክ ክፍሎች', en: 'Brake parts' },
    { slug: 'filters', am: 'ማጣሪያዎች', en: 'Filters' },
    { slug: 'tyres', am: 'ጎማዎች', en: 'Tyres' },
    { slug: 'electrical-parts', am: 'የኤሌክትሪክ ክፍሎች', en: 'Electrical parts' },
  ] },
  { slug: 'machine-parts', am: 'የማሽን መለዋወጫ', en: 'Machine spare parts', children: [
    { slug: 'bearings', am: 'ቤሪንግ', en: 'Bearings' },
    { slug: 'belts', am: 'ቀበቶ', en: 'Belts' },
    { slug: 'pumps', am: 'ፓምፕ', en: 'Pumps' },
    { slug: 'motors', am: 'ሞተር', en: 'Motors' },
  ] },
  { slug: 'wood-products', am: 'የእንጨት ውጤቶች', en: 'Wood products', children: [
    { slug: 'wooden-furniture', am: 'የቤት ዕቃዎች', en: 'Furniture' },
    { slug: 'doors', am: 'በሮች', en: 'Doors' },
    { slug: 'tables', am: 'ጠረጴዛዎች', en: 'Tables' },
    { slug: 'wooden-decor', am: 'የማስዋቢያ ዕቃዎች', en: 'Decorative items' },
  ] },
  { slug: 'leather-products', am: 'የቆዳ ውጤቶች', en: 'Leather products', children: [
    { slug: 'bags', am: 'ቦርሳዎች', en: 'Bags' },
    { slug: 'leather-belts', am: 'ቀበቶዎች', en: 'Belts' },
    { slug: 'leather-shoes', am: 'የቆዳ ጫማዎች', en: 'Leather shoes' },
  ] },
  { slug: 'metal-products', am: 'የብረትና አልሙኒየም ውጤቶች', en: 'Metal and aluminium products', children: [
    { slug: 'tools', am: 'መሳሪያዎች', en: 'Tools' },
    { slug: 'metal-furniture', am: 'የቤት ዕቃዎች', en: 'Furniture' },
    { slug: 'fittings', am: 'መገጣጠሚያዎች', en: 'Fittings' },
  ] },
  { slug: 'food-drinks', am: 'ምግብና መጠጥ', en: 'Food and drinks', children: [
    { slug: 'grains', am: 'እህሎች', en: 'Grains' },
    { slug: 'coffee', am: 'ቡና', en: 'Coffee' },
    { slug: 'canned-food', am: 'የታሸጉ ምግቦች', en: 'Canned food' },
    { slug: 'water', am: 'ውሃ', en: 'Water' },
    { slug: 'juice', am: 'ጭማቂ', en: 'Juice' },
  ] },
  { slug: 'home-kitchen', am: 'የቤትና የወጥ ቤት ዕቃዎች', en: 'Home and kitchen', children: [
    { slug: 'cookware', am: 'የማብሰያ ዕቃዎች', en: 'Cookware' },
    { slug: 'cleaning-supplies', am: 'የጽዳት ዕቃዎች', en: 'Cleaning supplies' },
    { slug: 'home-decor', am: 'የቤት ማስዋቢያ', en: 'Home decor' },
  ] },
  { slug: 'construction-electrical', am: 'የግንባታና የኤሌክትሪክ ዕቃዎች', en: 'Construction and electrical', children: [
    { slug: 'cement', am: 'ሲሚንቶ', en: 'Cement' },
    { slug: 'paint', am: 'ቀለም', en: 'Paint' },
    { slug: 'cables', am: 'ገመድ', en: 'Cables' },
    { slug: 'switches', am: 'ማብሪያ', en: 'Switches' },
    { slug: 'lighting', am: 'መብራት', en: 'Lighting' },
  ] },
  { slug: 'health-hygiene', am: 'የጤናና የግል ንጽህና', en: 'Health and personal hygiene', children: [
    { slug: 'hygiene-products', am: 'የንጽህና ዕቃዎች', en: 'Hygiene products' },
    { slug: 'first-aid', am: 'የመጀመሪያ እርዳታ', en: 'First aid' },
    { slug: 'health-monitoring', am: 'የጤና መለኪያዎች', en: 'Health monitoring devices' },
  ] },
  { slug: 'office-supplies', am: 'የቢሮ ዕቃዎች', en: 'Office supplies', children: [
    { slug: 'paper', am: 'ወረቀት', en: 'Paper' },
    { slug: 'pens', am: 'እስክሪብቶ', en: 'Pens' },
    { slug: 'printers', am: 'ፕሪንተር', en: 'Printers' },
    { slug: 'office-chairs', am: 'የቢሮ ወንበር', en: 'Office chairs' },
  ] },
  { slug: 'agriculture', am: 'የግብርና ዕቃዎች', en: 'Agricultural supplies', children: [
    { slug: 'farm-tools', am: 'የእርሻ መሳሪያዎች', en: 'Farm tools' },
    { slug: 'irrigation', am: 'የመስኖ ዕቃዎች', en: 'Irrigation equipment' },
    { slug: 'beekeeping', am: 'የማር ማምረቻ መሳሪያዎች', en: 'Beekeeping equipment' },
  ] },
  { slug: 'solar-energy', am: 'የኃይልና የፀሐይ ስርዓት', en: 'Energy and solar systems', children: [
    { slug: 'solar-panels', am: 'ሶላር ፓነሎች', en: 'Solar panels' },
    { slug: 'batteries', am: 'ባትሪዎች', en: 'Batteries' },
    { slug: 'inverters', am: 'ኢንቨርተሮች', en: 'Inverters' },
  ] },
  { slug: 'books-education', am: 'የመጽሐፍና የትምህርት ዕቃዎች', en: 'Books and education', children: [
    { slug: 'books', am: 'መጽሐፍት', en: 'Books' },
    { slug: 'dictionaries', am: 'መዝገበ ቃላት', en: 'Dictionaries' },
    { slug: 'education-tools', am: 'የትምህርት መሳሪያዎች', en: 'Educational tools' },
  ] },
];

const prisma = new PrismaClient();

/**
 * Afaan Oromo and Tigrinya names for the top-level categories, keyed by slug.
 * All of these are drafts: a native speaker must review them before they go live.
 */
const TOP_LEVEL_OM_TI: Record<string, { om: string; ti: string }> = {
  'clothing': { om: 'Uffata', ti: 'ክሳድ' },
  'electronics': { om: 'Elektirooniksii', ti: 'ኤሌክትሮኒክስ' },
  'kids-items': { om: 'Meeshaalee Ijoollee', ti: 'ናይ ቆልዑ ዕቃታት' },
  'shoes': { om: 'Kophee', ti: 'ጫማታት' },
  'sports-equipment': { om: 'Meeshaalee Ispoortii', ti: 'ናይ ስፖርት ዕቃታት' },
  'cosmetics': { om: 'Kosmetiksii', ti: 'ኮስሞቲክስ' },
  'jewelry-gifts': { om: 'Mararfannaa fi Kennaa', ti: 'ጌጣጌጥን ህያብን' },
  'car-parts': { om: 'Meeshaalee Konkolaataa', ti: 'ናይ መኪና ክፋላት' },
  'machine-parts': { om: 'Meeshaalee Mishiinii', ti: 'ናይ ማሽን ክፋላት' },
  'wood-products': { om: 'Oomisha Muka', ti: 'ናይ ዕንጨይቲ ምርትታት' },
  'leather-products': { om: 'Oomisha Qorichaa', ti: 'ናይ ቆርበት ምርትታት' },
  'metal-products': { om: 'Oomisha Biyyee fi Aluminiyeemii', ti: 'ናይ ብረትን ኣሉሚንየምን ምርትታት' },
  'food-drinks': { om: 'Nyaataa fi Dhugaa', ti: 'ምግቢን መጠጢን' },
  'home-kitchen': { om: 'Meeshaalee Manaa fi Gombisaa', ti: 'ናይ ገዛን ቤት ምግቢን ዕቃታት' },
  'construction-electrical': { om: 'Meeshaalee Ijaarsaa fi Elektirikii', ti: 'ናይ ህንጻን ኤሌክትሪክን ዕቃታት' },
  'health-hygiene': { om: 'Fayyaa fi Qulqullina Dhuunfaa', ti: 'ናይ ጥዕናን ውልቃዊ ጽሬትን' },
  'office-supplies': { om: 'Meeshaalee Waajjiraa', ti: 'ናይ ቤት ጽሕፈት ዕቃታት' },
  'agriculture': { om: 'Meeshaalee Qonnaa', ti: 'ናይ ሕርሻ ዕቃታት' },
  'solar-energy': { om: 'Humna fi Sirna Ifa Aduu', ti: 'ሃይልን ናይ ጸሓይ ሲስተምን' },
  'books-education': { om: 'Kitaabaa fi Barnoota', ti: 'ናይ መጻሕፍትን ትምህርትን ዕቃታት' },
};

/**
 * Afaan Oromo and Tigrinya names for sub-categories and deeper levels, keyed by slug.
 * Drafts, like the top-level names above. Slugs are unique across the whole catalog (checked by the seed test).
 */
const SUB_OM_TI: Record<string, { om: string; ti: string }> = {
  'traditional-clothing': { om: 'Uffata Aadaa', ti: 'ባህላዊ ክሳድ' },
  'netela': { om: 'Netelaa', ti: 'ነጠላ' },
  'gabi': { om: 'Gabii', ti: 'ጋቢ' },
  'traditional-dress': { om: 'Kallattii Aadaa', ti: 'ባህላዊ ቀሚስ' },
  'traditional-trousers': { om: 'Suruwwaa Aadaa', ti: 'ባህላዊ ሱሪ' },
  'modern-clothing': { om: 'Uffata Ammayyaa', ti: 'ዘመናዊ ክሳድ' },
  'mens-clothing': { om: 'Uffata Dhiira', ti: 'ናይ ተባዕታይ ክሳድ' },
  'womens-clothing': { om: 'Uffata Dhalaa', ti: 'ናይ ኣንስቲ ክሳድ' },
  'kids-clothing': { om: 'Uffata Ijoollee', ti: 'ናይ ቆልዑ ክሳድ' },
  'work-clothing': { om: 'Uffata Hojii', ti: 'ናይ ስራሕ ክሳድ' },
  'phones': { om: 'Bilbiloota', ti: 'ተሌፎናት' },
  'laptops': { om: 'Laaptoppii', ti: 'ላፕቶፖት' },
  'desktops': { om: 'Kompiyuutara Teebilii', ti: 'ዴስክቶፕ ኮምፒዩተራት' },
  'televisions': { om: 'Teelevizyiinii', ti: 'ቴለቭዥናት' },
  'smart-watches': { om: "Sa'aatii Smaartii", ti: 'ስማርት ሰዓታት' },
  'cameras': { om: 'Kaameeraawwan', ti: 'ካሜራታት' },
  'toys': { om: 'Meeshaalee Taphaa', ti: 'መጻወቲ ዕቃታት' },
  'educational-items': { om: 'Meeshaalee Barnootaa', ti: 'ናይ ትምህርቲ ዕቃታት' },
  'childcare': { om: 'Kunuunsa Ijoollee', ti: 'ናይ ቆልዑ ክንክን' },
  'traditional-shoes': { om: 'Kophee Aadaa', ti: 'ባህላዊ ጫማታት' },
  'modern-shoes': { om: 'Kophee Ammayyaa', ti: 'ዘመናዊ ጫማታት' },
  'sports-shoes': { om: 'Kophee Ispoortii', ti: 'ናይ ስፖርት ጫማታት' },
  'work-shoes': { om: 'Kophee Hojii', ti: 'ናይ ስራሕ ጫማታት' },
  'kids-shoes': { om: 'Kophee Ijoollee', ti: 'ናይ ቆልዑ ጫማታት' },
  'football': { om: 'Meeshaalee Kubbaa Miilaa', ti: 'ናይ ጉልቦል ዕቃታት' },
  'athletics': { om: 'Meeshaalee Atileetiksii', ti: 'ናይ ኣትሌቲክስ ዕቃታት' },
  'gym': { om: 'Meeshaalee Jiimii', ti: 'ናይ ጅም ዕቃታት' },
  'cycling': { om: 'Meeshaalee Bisiklii', ti: 'ናይ ብስክሌት ዕቃታት' },
  'skin-care': { om: 'Kunuunsa Fuula', ti: 'ክንክን ቆርበት' },
  'hair-products': { om: 'Meeshaalee Rifeensaa', ti: 'ናይ ጸጉሪ ዕቃታት' },
  'perfume': { om: 'Hanqaaqaa', ti: 'ሽቶ' },
  'makeup': { om: 'Meekaappii', ti: 'ሜክኣፕ' },
  'watches': { om: "Sa'aatii", ti: 'ሰዓታት' },
  'rings': { om: 'Mararfannaa Harkaa', ti: 'ቀለባት' },
  'bracelets': { om: 'Mararfannaa Harka Dhaabaa', ti: 'ሓብልታት' },
  'gift-items': { om: 'Meeshaalee Kennaa', ti: 'ናይ ህያብ ዕቃታት' },
  'brake-parts': { om: 'Qooda Breekii', ti: 'ናይ ብረይክ ክፋላት' },
  'filters': { om: 'Filtaroota', ti: 'ፊልተራት' },
  'tyres': { om: 'Taayirootaa', ti: 'ጎማታት' },
  'electrical-parts': { om: 'Qooda Elektirikii', ti: 'ናይ ኤሌክትሪክ ክፋላት' },
  'bearings': { om: 'Beeringii', ti: 'ቤሪንግ' },
  'belts': { om: 'Beeltii', ti: 'ቀበቶታት' },
  'pumps': { om: 'Pompii', ti: 'ፓምፕ' },
  'motors': { om: 'Mootara', ti: 'ሞተራት' },
  'wooden-furniture': { om: 'Meeshaalee Manaa Muka', ti: 'ናይ ዕንጨይቲ ቤት ዕቃታት' },
  'doors': { om: 'Balbala', ti: 'ደገፍቲ' },
  'tables': { om: 'Teebilii', ti: 'ጠረጴዛታት' },
  'wooden-decor': { om: 'Meeshaalee Miidhagsa Mukaa', ti: 'ናይ ዕንጨይቲ ምድማቕ ዕቃታት' },
  'bags': { om: 'Kiisaa', ti: 'ቦርሳታት' },
  'leather-belts': { om: 'Beeltii Qorichaa', ti: 'ናይ ቆርበት ቀበቶታት' },
  'leather-shoes': { om: 'Kophee Qorichaa', ti: 'ናይ ቆርበት ጫማታት' },
  'tools': { om: 'Meeshaalee', ti: 'መሳርሒታት' },
  'metal-furniture': { om: 'Meeshaalee Manaa Biyyee', ti: 'ናይ ብረት ቤት ዕቃታት' },
  'fittings': { om: 'Walitti Hidhuu', ti: 'ናይ ምትእስሳር ክፋላት' },
  'grains': { om: 'Hidhaa', ti: 'ናይ እህሊ ዓይነታት' },
  'coffee': { om: 'Buna', ti: 'ቡን' },
  'canned-food': { om: 'Nyaata Gabatame', ti: 'ዝታሸጉ ምግባት' },
  'water': { om: 'Bishaan', ti: 'ማይ' },
  'juice': { om: 'Juusii', ti: 'ጁስ' },
  'cookware': { om: 'Meeshaalee Nyaata Itti Gochuu', ti: 'ናይ ምብሳል ዕቃታት' },
  'cleaning-supplies': { om: 'Meeshaalee Qulqulleessuu', ti: 'ናይ ጽርየት ዕቃታት' },
  'home-decor': { om: 'Miidhagsa Manaa', ti: 'ናይ ቤት ምድማቕ' },
  'cement': { om: 'Simintoo', ti: 'ሲሚንቶ' },
  'paint': { om: 'Halluu', ti: 'ቀለም' },
  'cables': { om: 'Tambii', ti: 'ኬብላት' },
  'switches': { om: 'Swiichii', ti: 'ስዊችታት' },
  'lighting': { om: 'Ifa', ti: 'ብርሃን' },
  'hygiene-products': { om: 'Meeshaalee Qulqullina', ti: 'ናይ ጽሬት ዕቃታት' },
  'first-aid': { om: 'Gargaarsa Jalqabaa', ti: 'ቀዳማይ ሕክምና' },
  'health-monitoring': { om: 'Meeshaalee Fayyaa Ilaaluu', ti: 'ናይ ጥዕና ምልካት መሳርሒታት' },
  'paper': { om: 'Waraqaa', ti: 'ወረቐት' },
  'pens': { om: 'Qalama', ti: 'ብዕራት' },
  'printers': { om: 'Printeroota', ti: 'ፕሪንተራት' },
  'office-chairs': { om: 'Teessoo Waajjiraa', ti: 'ናይ ቤት ጽሕፈት ወንበራት' },
  'farm-tools': { om: 'Meeshaalee Qonnaa', ti: 'ናይ ሕርሻ መሳርሒታት' },
  'irrigation': { om: 'Meeshaalee Bishaan Dhangalaasuu', ti: 'ናይ መስኖ ዕቃታት' },
  'beekeeping': { om: 'Meeshaalee Damma Oomishuu', ti: 'ናይ ማር ምምራሕ መሳርሒታት' },
  'solar-panels': { om: 'Paanelii Aduu', ti: 'ሶላር ፓነላት' },
  'batteries': { om: 'Baatirii', ti: 'ባትሪታት' },
  'inverters': { om: 'Invertarootaa', ti: 'ኢንቨርተራት' },
  'books': { om: 'Kitaabota', ti: 'መጻሕፍቲ' },
  'dictionaries': { om: 'Kitaaba Jechootaa', ti: 'መዝገበ ቃላት' },
  'education-tools': { om: 'Meeshaalee Barnoota', ti: 'ናይ ትምህርቲ መሳርሒታት' },
};

/** Every level: top-level names plus sub-category names. */
const OM_TI: Record<string, { om: string; ti: string }> = { ...TOP_LEVEL_OM_TI, ...SUB_OM_TI };

/** Adds the Oromo and Tigrinya names to any category at any level that does not have them yet (safe to re-run). */
async function backfillOmTiNames(orgId: string): Promise<void> {
  for (const [slug, names] of Object.entries(OM_TI)) {
    await prisma.category.updateMany({
      where: { organizationId: orgId, slug, nameOm: null },
      data: { nameOm: names.om, nameTi: names.ti },
    });
  }
}

async function createTree(orgId: string, nodes: CategorySeed[], parentId: string | null): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    const created = await prisma.category.create({
      data: {
        organizationId: orgId,
        parentId,
        slug: node.slug,
        nameAm: node.am,
        nameEn: node.en,
        nameOm: OM_TI[node.slug]?.om ?? null,
        nameTi: OM_TI[node.slug]?.ti ?? null,
        sortOrder: index,
      },
    });
    if (node.children) await createTree(orgId, node.children, created.id);
  }
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } });
  for (const org of orgs) {
    await backfillOmTiNames(org.id);
    const existing = await prisma.category.count({ where: { organizationId: org.id } });
    if (existing > 0) {
      console.log(`skip ${org.slug}: already has ${existing} categories`);
      continue;
    }
    await createTree(org.id, CATALOG, null);
    console.log(`seeded categories for ${org.slug}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
