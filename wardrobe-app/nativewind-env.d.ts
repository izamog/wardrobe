/// <reference types="nativewind/types" />

// TypeScript 6 added a diagnostic for side-effect imports of files with no
// matching module declaration (TS2882); nativewind doesn't ship one for the
// global.css entry point it expects apps to import, so App.tsx's
// `import './global.css'` needs this declared here.
declare module '*.css';
