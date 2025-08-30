# Dropcaster Example Project

This is an example of how to use dropcaster as an npm package.

## Quick Start

```bash
# Create a new directory
mkdir my-gallery
cd my-gallery

# Initialize with dropcaster
npx @dropcaster/viewer init

# Install dependencies
npm install

# Add your sketches to public/sketches/

# Scan sketches
npm run scan

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
my-gallery/
├── dropcaster.config.js    # Configuration
├── package.json            # Dependencies
├── public/                 # Public files
│   ├── sketches/          # Your p5.js sketches
│   ├── previews/          # Generated previews
│   ├── avatars/           # User avatars
│   └── sketches.json      # Generated metadata
└── dist/                  # Build output (gitignored)
```

## Configuration

Edit `dropcaster.config.js` to customize:
- Gallery title and description
- PWA settings (colors, icons, offline mode)
- Cache strategy
- Social media links

## Adding Sketches

1. Create a folder in `public/sketches/` for each sketch
2. Add `index.html` and `mySketch.js` files
3. Run `npm run scan` to update the gallery

## Deployment

### GitHub Pages

```bash
npm run build
git add dist/
git commit -m "Build"
git push
```

Enable GitHub Pages from Settings > Pages > Source: Deploy from branch

### Netlify

1. Connect your GitHub repository
2. Build command: `npm run build`
3. Publish directory: `dist`

### Vercel

```bash
npm i -g vercel
npm run build
vercel dist
```

## Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run scan` - Scan sketches and generate metadata
- `npm run scan:full` - Scan with previews and user data

## License

MIT