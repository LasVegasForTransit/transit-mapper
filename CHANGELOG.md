# Changelog

## [0.6.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.5.1...v0.6.0) (2026-08-16)


### Features

* Add privacy-safe field telemetry ([0f05fc3](https://github.com/LasVegasForTransit/transit-mapper/commit/0f05fc39aac68b097cc6930acc77fd65ae9bcd38))
* **core:** Center shared service bundles ([d2545ea](https://github.com/LasVegasForTransit/transit-mapper/commit/d2545eaf6f409e79921b52ebf22005ab8b04a23a))
* **core:** draw physical rail hardware ([9692c13](https://github.com/LasVegasForTransit/transit-mapper/commit/9692c13fb779226e59c2b1f693891184b4ba0a3d))
* **core:** keep city-scale maps responsive ([64bb799](https://github.com/LasVegasForTransit/transit-mapper/commit/64bb799412cdcfb1a4ac7b720459290b31781431))
* **core:** match curve detail to the final display ([9e58df5](https://github.com/LasVegasForTransit/transit-mapper/commit/9e58df56ad65f7505f2033e4c6f89304838f1e95))
* **core:** render District carriageways as physical footprints ([c4e8dab](https://github.com/LasVegasForTransit/transit-mapper/commit/c4e8dab2d70fd18bebc615c13b774fe59de32588))
* **core:** render lanes as physical surfaces ([1b0029a](https://github.com/LasVegasForTransit/transit-mapper/commit/1b0029a823c14d1af609a1cca0ad4d6d9931bf08))
* **core:** resolve curved corridors in physical meters ([f8fdaa8](https://github.com/LasVegasForTransit/transit-mapper/commit/f8fdaa857d4508820b1c838269afa1caba3badff))
* **core:** Round physical junction curb returns ([99114db](https://github.com/LasVegasForTransit/transit-mapper/commit/99114dbdd50947a91a3ef3077fd79b0b7b5e6614))
* **core:** Show permitted lane movements through intersections ([14dfc83](https://github.com/LasVegasForTransit/transit-mapper/commit/14dfc83513bb503392790e676d154d1a67a08ed1))
* **core:** show streets and junctions at physical detail ([eca514a](https://github.com/LasVegasForTransit/transit-mapper/commit/eca514ad1ec9d33af7aecf9d7c849a3aca094380))
* **web:** add screen-space scene pipeline ([0ef1836](https://github.com/LasVegasForTransit/transit-mapper/commit/0ef18368dd4dd9d9f2b3009ccedcde0ada3bb652))
* **web:** keep exported maps consistent with the editor ([4bd80c2](https://github.com/LasVegasForTransit/transit-mapper/commit/4bd80c209f669aa2ece2f60d1dfe1621083b1da0))
* **web:** keep map edits visually continuous ([d4d61ce](https://github.com/LasVegasForTransit/transit-mapper/commit/d4d61ce749076f8e154d6deb6463898cc392e122))
* **web:** redesign onboarding around a real transit proposal ([#97](https://github.com/LasVegasForTransit/transit-mapper/issues/97)) ([0afe298](https://github.com/LasVegasForTransit/transit-mapper/commit/0afe298d825f656561f84170ea417178bde4e067))
* **web:** Reduce clutter in dense map views ([5d36191](https://github.com/LasVegasForTransit/transit-mapper/commit/5d3619131eb6a7b2b5a1f9452d75a5ee957877ec))


### Bug Fixes

* **ci:** keep repository tooling validation lint-safe ([c5b6e23](https://github.com/LasVegasForTransit/transit-mapper/commit/c5b6e23ddbe6aa84293b8d9a4b5a0199ec838fb1))
* **ci:** Measure first-load delivery ([e6f62c3](https://github.com/LasVegasForTransit/transit-mapper/commit/e6f62c3e2f06d3f1db7a60a32ff252f79e9a6a00))
* **ci:** Track renderer worker bundles ([f61b7d9](https://github.com/LasVegasForTransit/transit-mapper/commit/f61b7d926b7e5df12d9715612a1d41a985901d19))
* **core:** render services through public Lines ([cd927c7](https://github.com/LasVegasForTransit/transit-mapper/commit/cd927c72403aef79ffb7027b36341960bd15593b))
* **dx:** attribute Codex-authored commits ([c54437d](https://github.com/LasVegasForTransit/transit-mapper/commit/c54437d5b3b15bb0a69a7598c282abab3e22d3d3))
* **pwa:** Let saved maps stay editable offline ([61b7e37](https://github.com/LasVegasForTransit/transit-mapper/commit/61b7e3789a9b83ffda6fc716b97c017b2d9f8f11))
* **web:** Expose fixtures to renderer acceptance captures ([a1b21f1](https://github.com/LasVegasForTransit/transit-mapper/commit/a1b21f1b99cdf0c5d57c8507b0a5c201953fb64f))
* **web:** join lane services through Street junctions ([6cb32fd](https://github.com/LasVegasForTransit/transit-mapper/commit/6cb32fd2dbeb00d39368b0337a3018131ecb160d))
* **web:** Keep cold maps from dropping their first renderer scene ([cfd9fa8](https://github.com/LasVegasForTransit/transit-mapper/commit/cfd9fa809ffe130362d51ce0afddede184434106))
* **web:** Keep cold maps interactive during startup ([1ea8246](https://github.com/LasVegasForTransit/transit-mapper/commit/1ea8246cd6aef4403b38947a74ae79c72b41b832))
* **web:** keep editor overlays behind accepted map revisions ([17cc3ab](https://github.com/LasVegasForTransit/transit-mapper/commit/17cc3abab65b7a456246b09c6535066d992b89cb))
* **web:** Keep edits from showing outdated map geometry ([3bb7a35](https://github.com/LasVegasForTransit/transit-mapper/commit/3bb7a351c56239e54c7cd7e1a5de15a0f05b934c))
* **web:** Keep empty renderer sources from blocking bank changes ([162d4af](https://github.com/LasVegasForTransit/transit-mapper/commit/162d4af00223a59093e1e5c1cce366073a779bb7))
* **web:** Keep incoming renderer banks coherent ([ddaa049](https://github.com/LasVegasForTransit/transit-mapper/commit/ddaa04907c71732dce3b740e13962819f71a5166))
* **web:** Keep LOD captures on the editor command boundary ([11f3266](https://github.com/LasVegasForTransit/transit-mapper/commit/11f3266819c9c9a20413e5898f9a6f446e7c8c4d))
* **web:** Keep renderer contracts independent of density ([20fa346](https://github.com/LasVegasForTransit/transit-mapper/commit/20fa346c6dc7c2b20edc36ea3bee9313bb4ddc08))
* **web:** Keep resumed projections visually equivalent ([6a35766](https://github.com/LasVegasForTransit/transit-mapper/commit/6a357661e496569442f513c2084081c5b0ccae9c))
* **web:** Keep stops available in embeds and inspectors ([3fe82a9](https://github.com/LasVegasForTransit/transit-mapper/commit/3fe82a97bc80db1826d619216382e2e13a387fc2))
* **web:** Let a saved system publish its first scene ([#104](https://github.com/LasVegasForTransit/transit-mapper/issues/104)) ([342ea11](https://github.com/LasVegasForTransit/transit-mapper/commit/342ea11ff8eb83fcad368812b179b9a83ec1d3a2))
* **web:** name canceled CDP requests in byte audits ([308a1cd](https://github.com/LasVegasForTransit/transit-mapper/commit/308a1cd66fb55cd1297590c42168e6db9b39ecc9))
* **web:** Preserve delivery graph transitions ([a27c698](https://github.com/LasVegasForTransit/transit-mapper/commit/a27c69833b1330acc467246ce93280bc95793670))
* **web:** preserve incremental rendering for local edits ([76f6fc3](https://github.com/LasVegasForTransit/transit-mapper/commit/76f6fc3d584cde1ab57a7d76d9561b946bdcc276))
* **web:** Preserve renderer behavior after delivery rebase ([0b66146](https://github.com/LasVegasForTransit/transit-mapper/commit/0b6614671161440c945634555e298df4ef9d76ef))
* **web:** restore the editor delivery budget ([7525559](https://github.com/LasVegasForTransit/transit-mapper/commit/7525559fa83c113d58c431323a8e5b2446080778))
* **web:** retire stale renderer source metadata ([d514050](https://github.com/LasVegasForTransit/transit-mapper/commit/d5140507ea4b6f1b3b43ea6033fc8077af1e6e2a))


### Performance Improvements

* **web:** defer SVG exporter until requested ([0405b22](https://github.com/LasVegasForTransit/transit-mapper/commit/0405b2229a18286a03da9802ca732d4bdd2a4ac8))

## [0.5.1](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.5.0...v0.5.1) (2026-08-13)


### Bug Fixes

* **ci:** document generated Worker artifact contract ([bcba843](https://github.com/LasVegasForTransit/transit-mapper/commit/bcba8431fdb3198d112e430bf77e7c021a2c953f))

## [0.5.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.4.0...v0.5.0) (2026-08-13)


### Features

* **core:** separate stations from stops ([508a4b3](https://github.com/LasVegasForTransit/transit-mapper/commit/508a4b34865530cd32c25d4f52d26829f9819576))
* **editor:** distinguish stations from stops ([bc11720](https://github.com/LasVegasForTransit/transit-mapper/commit/bc1172017838a50e5edd21b5956a89305991d93d))


### Bug Fixes

* **editor:** clarify responsive sidebar chrome ([64a478d](https://github.com/LasVegasForTransit/transit-mapper/commit/64a478d48523f72438c2a2560b4ba559b4a71793))
* make OpenStreetMap imports metro-wide and resilient ([1191130](https://github.com/LasVegasForTransit/transit-mapper/commit/1191130dafbae30789c1771077d4956305f523bf))
* **perf:** exercise Stops in editor journeys ([54e95b8](https://github.com/LasVegasForTransit/transit-mapper/commit/54e95b81b8357249ff57175b0325d1ce2abde410))
* preserve metro import topology across tile seams ([5312bf7](https://github.com/LasVegasForTransit/transit-mapper/commit/5312bf77ed70c2757f0df3802569ccacf2b9bffb))
* use editor commands for metro imports ([497a549](https://github.com/LasVegasForTransit/transit-mapper/commit/497a549978bed5d1e96f7cc2c2ad6b2af8a01cc5))
* **web:** harden saved-system accessibility ([805cae9](https://github.com/LasVegasForTransit/transit-mapper/commit/805cae9695a23cd376476bd1a228af71b80ddf65))
* **web:** make saved systems easy to open ([f768db9](https://github.com/LasVegasForTransit/transit-mapper/commit/f768db95206e8a4b6f2acfeaabf0c5923953f2c0))


### Performance Improvements

* **web:** keep passenger-place UI within bundle policy ([97cd027](https://github.com/LasVegasForTransit/transit-mapper/commit/97cd0274613b036662d115df0ba1a518b863a463))
* **web:** move system previews off the input thread ([68d43af](https://github.com/LasVegasForTransit/transit-mapper/commit/68d43af342eb48e7885b0024d9ee41b041b520ca))

## [0.4.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.3.2...v0.4.0) (2026-08-11)


### Features

* **editor:** reorganize the network sidebar ([395178a](https://github.com/LasVegasForTransit/transit-mapper/commit/395178ac40d9db5ebd893abb0d3fc0254184eb58))
* enforce GitHub contribution metadata ([5ed1209](https://github.com/LasVegasForTransit/transit-mapper/commit/5ed1209d64d2a197f6f7a534895f6c6dd1b1c334))


### Bug Fixes

* **core:** preserve stops during corridor reconciliation ([e7f7dfd](https://github.com/LasVegasForTransit/transit-mapper/commit/e7f7dfd14d87f9cc1e3410c761d6a0817f8e3d49))
* publish invalid contribution metadata status ([22a4ffc](https://github.com/LasVegasForTransit/transit-mapper/commit/22a4ffc083753f057fafef79f8675bbd806a2de7))
* validate workflow-created release PRs ([307c3a0](https://github.com/LasVegasForTransit/transit-mapper/commit/307c3a08935f4787ccb355d37b30c381475f78b5))

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
