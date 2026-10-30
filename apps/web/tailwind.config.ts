import type { Config } from "tailwindcss";
const config: Config = { content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"], theme: { extend: { colors: { ink: "#101c3a", brand: "#087cc1", gold: "#e9ad20" } } }, plugins: [] };
export default config;
