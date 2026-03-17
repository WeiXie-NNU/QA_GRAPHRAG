/// <reference types="vite/client" />

declare module "*.geojson" {
  const value: object;
  export default value;
}
