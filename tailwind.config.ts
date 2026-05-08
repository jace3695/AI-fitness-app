import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#534AB7',
          light: '#EEEDFE',
          dark: '#3C3489',
          border: '#AFA9EC',
        },
        fgreen: {
          DEFAULT: '#1D9E75',
          dark: '#0F6E56',
          light: '#E1F5EE',
          border: '#9FE1CB',
          mid: '#EAF3DE',
          text: '#27500A',
          bold: '#3B6D11',
          brand: '#639922',
        },
        forange: {
          DEFAULT: '#EF9F27',
          dark: '#854F0B',
          text: '#633806',
          light: '#FAEEDA',
          border: '#FAC775',
        },
        fblue: {
          DEFAULT: '#378ADD',
          dark: '#0C447C',
          mid: '#185FA5',
          light: '#E6F1FB',
        },
        fred: {
          DEFAULT: '#E24B4A',
          dark: '#A32D2D',
          text: '#791F1F',
          light: '#FCEBEB',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Pretendard',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
