/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./App.tsx",
        "./index.tsx",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./views/**/*.{js,ts,jsx,tsx}"
    ],
    theme: {
        extend: {
            animation: {
                'spin-slow': 'spin 8s linear infinite',
            },
        },
    },
    plugins: [],
}
