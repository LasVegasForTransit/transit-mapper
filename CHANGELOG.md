# Changelog

## [0.3.2](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.3.1...v0.3.2) (2026-08-09)


### Bug Fixes

* **web:** keep closed menu triggers clickable ([8318d3f](https://github.com/LasVegasForTransit/transit-mapper/commit/8318d3f3a00989aa3ff92535067a422438632f0a))

## [0.3.1](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.3.0...v0.3.1) (2026-08-09)


### Bug Fixes

* drop the upstream cache layer that cannot be purged ([9204e26](https://github.com/LasVegasForTransit/transit-mapper/commit/9204e26d4b4aaca46f6b04ad851148bf882ac20c))
* stop caching RTC's refusal for a day and re-serving it ([4ef4539](https://github.com/LasVegasForTransit/transit-mapper/commit/4ef45399c0a800b6cfc2d869b6176a91a9a5b08c))

## [0.3.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.2.0...v0.3.0) (2026-08-09)


### Features

* **editor:** close a drawn way into a real loop at its own start ([053738e](https://github.com/LasVegasForTransit/transit-mapper/commit/053738e32b8dd6bd48c8cceb0d2f9184a76f9d2c))
* **editor:** offer Separate carriageways from a street's own menu ([f7ec35d](https://github.com/LasVegasForTransit/transit-mapper/commit/f7ec35d3f2b9edcab76adf87334d282b38cd7ef5))
* **editor:** take one way back out of a junction ([51f0bc8](https://github.com/LasVegasForTransit/transit-mapper/commit/51f0bc8a38f1c0ed616ef39b51d98405cada8b8d))
* **repo:** require attribution when an agent commits ([72c3a8b](https://github.com/LasVegasForTransit/transit-mapper/commit/72c3a8b97c9e887b86f35f6a639611ab51484dea))
* Resync auto-named stations after every service-adding action ([8b6bd15](https://github.com/LasVegasForTransit/transit-mapper/commit/8b6bd1594921b5fdb07f40be1ed3b4fe7103e00c))
* **web:** let the bottom panel open part way ([a1bef5a](https://github.com/LasVegasForTransit/transit-mapper/commit/a1bef5ab379a4ab6f62d750dbf43778a0df99658))
* **web:** make the drawing tools big enough to tap ([6ea3800](https://github.com/LasVegasForTransit/transit-mapper/commit/6ea38002b42e1d27131286294fa1848eee9abb5d))
* **web:** move a phone's controls to the edges of the screen ([9bd5e73](https://github.com/LasVegasForTransit/transit-mapper/commit/9bd5e737e7e3346a09f76f232dec3720689396c2))
* **web:** open dialogs from the bottom of the screen on a phone ([1eeba66](https://github.com/LasVegasForTransit/transit-mapper/commit/1eeba666ad7d294a28651de3350c73070a27e33f))
* **web:** say how to draw and edit with a finger ([df3f351](https://github.com/LasVegasForTransit/transit-mapper/commit/df3f351b1e9b4b1c25ce7a62c4043d2ac7e578d8))


### Bug Fixes

* **core:** refuse a junction between two different way types ([0c9a1af](https://github.com/LasVegasForTransit/transit-mapper/commit/0c9a1af8ac3b11e965175892ff678ffdb4956745))
* **core:** repair a document as it loads, rather than warn about it ([59fd9d0](https://github.com/LasVegasForTransit/transit-mapper/commit/59fd9d00ed58175e751f9757b6c43bf76a90a266))
* **core:** stop reporting a level-crossing gap as a plan issue ([8cc8601](https://github.com/LasVegasForTransit/transit-mapper/commit/8cc8601801b67ff599edc8231065beaffef3802e))
* **core:** stop the loader from deleting a line it can't place ([54995d4](https://github.com/LasVegasForTransit/transit-mapper/commit/54995d4c411b552262dc5d7b4d4ff268c5e59aa2))
* **editor:** keep drawing active through an undo or redo mid-draw ([85c3e8c](https://github.com/LasVegasForTransit/transit-mapper/commit/85c3e8ce44dbd06d62a1989aba619da473ccecb2))
* **editor:** make ghost ways and unjoined crossings impossible to create ([ef5e78b](https://github.com/LasVegasForTransit/transit-mapper/commit/ef5e78b4eaf8a4953161ec0c5d089be5cf920b54))
* **editor:** reconnect a separated carriageway to its crossing streets ([d09bf72](https://github.com/LasVegasForTransit/transit-mapper/commit/d09bf727963472e3996affec9fd1890253b252f0))
* **editor:** stop stations drifting when a way's endpoint is extended ([8b5d6de](https://github.com/LasVegasForTransit/transit-mapper/commit/8b5d6de8b196687ac12ac4adb0881a815de82268))
* identify the app so RTC stops refusing the GTFS proxy ([eb66665](https://github.com/LasVegasForTransit/transit-mapper/commit/eb66665527da8ced66b6483ac6667b62375966cc))
* **map:** tell the camera where the chrome is ([13c00a0](https://github.com/LasVegasForTransit/transit-mapper/commit/13c00a045845186acda4fb6cc067d3e14c8ba38c))
* state no version in the RTC user agent rather than a made-up one ([4cd095f](https://github.com/LasVegasForTransit/transit-mapper/commit/4cd095ff521a889a9c8fb84867d80a00c0f067f5))
* **ui:** keep the top app bars to one row, and dock the install banner ([#56](https://github.com/LasVegasForTransit/transit-mapper/issues/56)) ([a71dc98](https://github.com/LasVegasForTransit/transit-mapper/commit/a71dc986b720a21c73a633f2f2256bd10c8c297e))
* **web:** centre the tool dock on the map, not on the window ([9b86e55](https://github.com/LasVegasForTransit/transit-mapper/commit/9b86e55f7650d724b6651bf0c2812712f0c57ffe))
* **web:** Explain when something failed because you're offline ([51696a1](https://github.com/LasVegasForTransit/transit-mapper/commit/51696a18cb1ea6f4ff3b220e2b65bf7824813e4b))
* **web:** keep settings and help reachable on a smaller window ([3185acd](https://github.com/LasVegasForTransit/transit-mapper/commit/3185acd24d7a0b5a6c1f134713e161d07291ec56))
* **web:** keep the issues list to things somebody can act on ([4471d77](https://github.com/LasVegasForTransit/transit-mapper/commit/4471d774f6d9c6851b637d3ad0c8f15b8755e0e8))
* **web:** let a phone's detail panel use the whole screen width ([d132c94](https://github.com/LasVegasForTransit/transit-mapper/commit/d132c946d4c417f6565b36e81b355662471f0b5a))
* **web:** show every view and the clock on a narrow window ([014b2c2](https://github.com/LasVegasForTransit/transit-mapper/commit/014b2c2e3d73f7d7f87d3ecdc6ea2de8329a7a78))
* **web:** show the actions that only appeared on hover ([5269082](https://github.com/LasVegasForTransit/transit-mapper/commit/526908278ecff9ccbbee47440cbdf4536c23c9fe))
* **web:** Show the editor right away instead of a loading screen ([31fb071](https://github.com/LasVegasForTransit/transit-mapper/commit/31fb071f166b092827c7c56f2be0684f869821e8))
* **web:** stop a closing panel swallowing the next tap ([d8a867a](https://github.com/LasVegasForTransit/transit-mapper/commit/d8a867a90744707f830737e37693e5e294de1398))
* **web:** Stop showing a name for a system that hasn't opened yet ([b4634da](https://github.com/LasVegasForTransit/transit-mapper/commit/b4634da0e1190a1ed62bb6347686b2c0cb14daa7))
* **web:** Stop the install invite competing with an app notice ([1294910](https://github.com/LasVegasForTransit/transit-mapper/commit/12949100879faf11bc52775ec49ef61dd8ac5fd9))
* **web:** use the phone layout on a short screen, not just a narrow one ([79154cd](https://github.com/LasVegasForTransit/transit-mapper/commit/79154cd554adce36483a7c83c0a19fdb4ffafe9d))

## [0.2.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.1.0...v0.2.0) (2026-08-02)


### Features

* add build provenance and About dialog ([669b9fe](https://github.com/LasVegasForTransit/transit-mapper/commit/669b9fea6817c889182230343053ce7b8a988494))
* **web:** redesign editable onboarding ([f3181fe](https://github.com/LasVegasForTransit/transit-mapper/commit/f3181feb918b61339555d5eec3de468876463290))


### Bug Fixes

* **ci:** accept generated release changelog ([2a5c815](https://github.com/LasVegasForTransit/transit-mapper/commit/2a5c8156c0e7e3d817772b71d402fefbc7bf6192))
* **ci:** dispatch release validation without checkout ([1d0c2ed](https://github.com/LasVegasForTransit/transit-mapper/commit/1d0c2ed3b8356d216160203d87e7f4b6901ee8dd))
* **web:** address onboarding review findings ([131d614](https://github.com/LasVegasForTransit/transit-mapper/commit/131d6148c871eae06933e0d6c66dc0cb52dae2ec))
