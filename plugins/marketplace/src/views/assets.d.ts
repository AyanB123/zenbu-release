// Lets TypeScript accept Vite's URL-as-asset imports for the mock
// screenshots. The runtime side is handled by Vite's default asset
// handling (any `import x from "./foo.png"` resolves to a hashed
// URL string).
declare module "*.png" {
  const src: string
  export default src
}

declare module "*.svg" {
  const src: string
  export default src
}
