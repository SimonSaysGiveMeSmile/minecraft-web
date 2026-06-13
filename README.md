# Minecraft Web — Build Anything With Words

By **[SimonSaysGiveMeSmile](https://github.com/SimonSaysGiveMeSmile)**

Play: **https://minecraft-web-phi.vercel.app**

A browser Minecraft clone (Three.js + TypeScript) with a twist: press **B**,
type a description — *"a giant glass castle"*, *"wooden ship"*, *"rainbow"* —
and watch it get built **block by block, right in front of your eyes**.

## The Word Builder

- **B** opens the build prompt while playing
- Understands ~20 shapes: house, castle, tower, pyramid, tree, bridge, ship,
  wall, sphere, cube, arch, statue, heart, star, smiley, rainbow, pillar,
  fountain, igloo, snowman — plus synonyms
- Modifiers: materials (*stone, wooden, glass, diamond, quartz, sand, …*)
  and sizes (*tiny, small, big, giant, massive*)
- Anything it doesn't recognize gets spelled out as **giant block letters**,
  so every description builds *something*
- Structures face you, sit on the terrain, and animate in over ~4 seconds

## Controls

| Key | Action |
| --- | --- |
| WASD / Space / Shift | move / jump / sneak |
| Left / Right click | destroy / place block |
| **B** | **build anything from words** |
| Q | toggle flying |
| E | menu |
| F | fullscreen |

## Develop

```bash
npm install
npm run dev     # local dev server
npm run build   # production build to dist/
```

## Credits

The word builder (`src/builder/`) and this build are by
**[SimonSaysGiveMeSmile](https://github.com/SimonSaysGiveMeSmile)**.

Built on the excellent MIT-licensed
[minecraft-threejs](https://github.com/Vyse12138/minecraft-threejs) by
Yulei Zhu (Vyse12138), whose original copyright is retained in `LICENSE` per
the MIT terms.
