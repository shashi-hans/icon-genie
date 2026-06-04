// SVGO configuration used by scripts/optimize-svgs.js
// Goal: shrink path data while preserving the inner markup that the
// component generator later extracts verbatim. We keep the viewBox (so the
// raw SVGs stay valid standalone) and never strip the duotone `opacity`
// layer, which is what makes duotone look the way it does.
//
// ESM because package.json sets "type": "module".
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          // The component hardcodes viewBox="0 0 256 256"; keep it on the raw
          // file too so the SVGs remain usable on their own.
          removeViewBox: false,
          // Phosphor relies on fill="currentColor"; do not collapse it away.
          removeUselessStrokeAndFill: false,
          // Path-merge can fuse the duotone tint path into the main path; the
          // two carry different opacity, so leave them separate to be safe.
          mergePaths: false,
        },
      },
    },
  ],
};
