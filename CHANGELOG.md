# Changelog

## [0.7.3](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.7.2...v0.7.3) (2026-08-27)


### Bug Fixes

* **ci:** Build workspace packages before route smoke ([78ff43e](https://github.com/LasVegasForTransit/transit-mapper/commit/78ff43ee17c6eee2662f4430f3a771a639b4f7c2))
* **ci:** Gate releases on working map routes ([86ec216](https://github.com/LasVegasForTransit/transit-mapper/commit/86ec216954e179cc44ac430f2b4a97e7fcbeccae))
* **ci:** Keep functional smokes free of timing budgets ([6156511](https://github.com/LasVegasForTransit/transit-mapper/commit/61565114c5fde57e42390f9cb4ac31f98f40f70b))
* **ci:** Separate release smokes from performance audits ([27e1e29](https://github.com/LasVegasForTransit/transit-mapper/commit/27e1e2996d5cefa04ece0920084db27b518e7e6d))
* **web:** Paint transit before loading the basemap ([70c80aa](https://github.com/LasVegasForTransit/transit-mapper/commit/70c80aa09e2aba5579ba76b50362d03b73503853))
* **web:** Wait for first system paint before capture ([a155c2a](https://github.com/LasVegasForTransit/transit-mapper/commit/a155c2acba81ed3edc5c8bb1fbdcbcdc02636d42))

## [0.7.2](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.7.1...v0.7.2) (2026-08-27)


### Bug Fixes

* **ci:** Preserve explicit release markers ([124041d](https://github.com/LasVegasForTransit/transit-mapper/commit/124041de1618835e479dbaf5ec42ae977d5f0264))

## [0.7.1](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.7.0...v0.7.1) (2026-08-27)


### Bug Fixes

* **ci:** Deploy approved releases after failed gates ([2a50f22](https://github.com/LasVegasForTransit/transit-mapper/commit/2a50f221552af0ce65a81559e81d7849525b7378))
* **ci:** Read published release draft state ([b588793](https://github.com/LasVegasForTransit/transit-mapper/commit/b58879345269aff431a776b3f19c1bb6b72d1f80))
* **ci:** Resume published releases without repeated gates ([b3ccf71](https://github.com/LasVegasForTransit/transit-mapper/commit/b3ccf71d9fef3f60969b28805d8a0ee654869031))
* **ci:** Validate resumed releases from their tag ([11a7b12](https://github.com/LasVegasForTransit/transit-mapper/commit/11a7b12bdc6d90fe25886ca34f95fd0e1442c10d))
* **web:** Measure the visible viewer shell ([8b6513a](https://github.com/LasVegasForTransit/transit-mapper/commit/8b6513aeda5b6bc8f32a8e8e89792771457a7ee6))
* **web:** Report viewer shell startup ([8ba22b0](https://github.com/LasVegasForTransit/transit-mapper/commit/8ba22b069d99b00c4c4d2da8fa9fafd813dc601d))
* **web:** Restore map startup milestones ([2be14c0](https://github.com/LasVegasForTransit/transit-mapper/commit/2be14c0e699a74c428351514f6c0db6e85311260))
* **web:** Verify production map interaction directly ([04cde83](https://github.com/LasVegasForTransit/transit-mapper/commit/04cde83421c9c467aca1656a22057408a739eaf7))

## [0.7.0](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.6.1...v0.7.0) (2026-08-26)


### Features

* Add deferred map driver loading ([6f949be](https://github.com/LasVegasForTransit/transit-mapper/commit/6f949be9464a7489fb77bcbaac142f9221ef6403))
* Add portable transient View links ([34c94be](https://github.com/LasVegasForTransit/transit-mapper/commit/34c94bebee752d6ab4a2415810d929a79a918aa2))
* Add representation-specific document layer plans ([b8e493e](https://github.com/LasVegasForTransit/transit-mapper/commit/b8e493e0d027b91f34ebfe70dfac154d20d4bd12))
* Add reusable map surface lifecycle ([15953d3](https://github.com/LasVegasForTransit/transit-mapper/commit/15953d3e8cb565633bb9a3b86c564848b9c46937))
* Connect document scenes to surface interactions ([7b88dbe](https://github.com/LasVegasForTransit/transit-mapper/commit/7b88dbe8dba99247f18251cf9b857609ef917d7c))
* Define the published View API contract ([b4d81db](https://github.com/LasVegasForTransit/transit-mapper/commit/b4d81dbcc62d145f1a12a2588bef9fb2710c433d))
* Deliver named View readers and embeds ([d6fec17](https://github.com/LasVegasForTransit/transit-mapper/commit/d6fec17f3039642401f36ed0605371525e9bd681))
* Inject document renderer instrumentation ([698d8ae](https://github.com/LasVegasForTransit/transit-mapper/commit/698d8ae2501adff6286a60b607ca02823ab663a6))
* Restore named Views in embeds ([6ca7eb2](https://github.com/LasVegasForTransit/transit-mapper/commit/6ca7eb2269897f3f654cb63a907828a76e50fb6e))
* Schedule map attachment after the shell paints ([e262412](https://github.com/LasVegasForTransit/transit-mapper/commit/e262412d6dcc5cd582c9004b6aa40dd0844e6a59))
* Share the responsive map workspace ([9181141](https://github.com/LasVegasForTransit/transit-mapper/commit/918114195f8dadabdb29f367dab836c5d975d546))
* Validate View state against map definitions ([2a26bc4](https://github.com/LasVegasForTransit/transit-mapper/commit/2a26bc4ad20d3306226f77b85df63c775a5bdb98))
* **web:** Add Saved views to the editor ([76867f7](https://github.com/LasVegasForTransit/transit-mapper/commit/76867f78674d4313962431f470f2c48c296775b8))
* **web:** Add the editor map attachment boundary ([cca8c43](https://github.com/LasVegasForTransit/transit-mapper/commit/cca8c43c8d8346038fec33c07f8d25f3573b23b1))
* **web:** Add the published View client ([ea8003a](https://github.com/LasVegasForTransit/transit-mapper/commit/ea8003a72d1e2d7d6be3ad01eb691de324ac5dcf))
* **web:** Add the saved View workflow ([fab694d](https://github.com/LasVegasForTransit/transit-mapper/commit/fab694ddad410196be909e6634b726714a482076))
* **web:** Assemble the editor map driver ([3c7e621](https://github.com/LasVegasForTransit/transit-mapper/commit/3c7e6218be165000987ecba6a1110fa053d5a2c5))
* **web:** Hold document projection during gestures ([46da7f3](https://github.com/LasVegasForTransit/transit-mapper/commit/46da7f374bf10f3ea4578b315cef8f56ba3bf52f))
* **web:** Isolate editor gesture projection ([58c6b52](https://github.com/LasVegasForTransit/transit-mapper/commit/58c6b52517a4ee6337c75d2bafee3fb15d6ea26b))
* **web:** Mount the editor on the shared map surface ([8746549](https://github.com/LasVegasForTransit/transit-mapper/commit/8746549881af917f5ad1d92db189c1f83c3bdd84))
* **web:** Open published Views in the viewer ([b40127b](https://github.com/LasVegasForTransit/transit-mapper/commit/b40127b83f21d54816a766a35122fa293d934143))
* **web:** Open shared systems in the reader ([7c1d556](https://github.com/LasVegasForTransit/transit-mapper/commit/7c1d556fac314882ae3f71863aaee1cffcae9026))
* **web:** Preserve native map navigation state ([30e6fca](https://github.com/LasVegasForTransit/transit-mapper/commit/30e6fca0862ac70fe2d8a0a147eb0c2582a15365))
* **web:** Resolve reader selections from map features ([f64b8d1](https://github.com/LasVegasForTransit/transit-mapper/commit/f64b8d115728d2ab93804a4c79353771a03c8d72))
* **web:** Resolve shared systems as Views ([ef5bbf6](https://github.com/LasVegasForTransit/transit-mapper/commit/ef5bbf61b041453c18e7d6f581c3cd3ff8647e57))
* **web:** Separate editor map layer ownership ([3e4168c](https://github.com/LasVegasForTransit/transit-mapper/commit/3e4168c652177e4188435ed8b2ecb3f8f075b873))
* **web:** Store local Views outside transit documents ([0537303](https://github.com/LasVegasForTransit/transit-mapper/commit/0537303272806a31085f5c5a88aab53ffdfa9083))
* **worker:** Publish named Views ([85c8adf](https://github.com/LasVegasForTransit/transit-mapper/commit/85c8adfa2694ea66caf92684b5cd38054734d815))


### Bug Fixes

* Apply map themes before restoring style layers ([22b84e1](https://github.com/LasVegasForTransit/transit-mapper/commit/22b84e18a615f6392b7e91f371ae2ec4d48d8998))
* Attach document sessions after overlay setup ([67a2726](https://github.com/LasVegasForTransit/transit-mapper/commit/67a27265b082ce9e51403f4de76720abb62b688a))
* Bound saved View JSON parsing ([4379b6a](https://github.com/LasVegasForTransit/transit-mapper/commit/4379b6a7eea444f11ccd783b4f8b1a0e43f55cfd))
* Contain map theme callback failures ([e7e62fa](https://github.com/LasVegasForTransit/transit-mapper/commit/e7e62fa4a0b12a8e965b3711d9883695ca0b65ef))
* **dx:** Build performance runs through Turbo ([1a86385](https://github.com/LasVegasForTransit/transit-mapper/commit/1a86385ed3524d4e123169e2e5fb56d1bf0ce569))
* **dx:** Keep boundary checks independent of build output ([928bb2d](https://github.com/LasVegasForTransit/transit-mapper/commit/928bb2da5e0680ad6fd5db1cc39bca872d452694))
* Ignore superseded map theme failures ([e807e61](https://github.com/LasVegasForTransit/transit-mapper/commit/e807e61487a51f12d2816a5964441ec40d1b29d8))
* Keep centered workspace notices interactive ([cf992a2](https://github.com/LasVegasForTransit/transit-mapper/commit/cf992a290f8f82a692885aacd6e8e9fd3e3f8e5e))
* Keep document map state consistent during updates ([b680170](https://github.com/LasVegasForTransit/transit-mapper/commit/b6801705fbc1a53e3f551178a534553d67375424))
* Keep fallback sessions local and enforce release performance ([28279da](https://github.com/LasVegasForTransit/transit-mapper/commit/28279da7d3b283dac43cd9612d47e370d6f72112))
* Keep map themes aligned with applied styles ([4d7b1f0](https://github.com/LasVegasForTransit/transit-mapper/commit/4d7b1f0be185d40a7bd5dc420357e96927f3f4c7))
* Keep remote base styles through valid transitions ([0e2b804](https://github.com/LasVegasForTransit/transit-mapper/commit/0e2b804ad5b31a3c808193a785fb50e79ff51523))
* Keep shared maps visible when the viewer opens ([4c4b8ee](https://github.com/LasVegasForTransit/transit-mapper/commit/4c4b8ee1f4772dedcf6a9b4a1c4c2bc37e2a9580))
* Preserve transit overlays during base style changes ([daa48be](https://github.com/LasVegasForTransit/transit-mapper/commit/daa48bef104ff994c9044fca0ddde43e07a4f00a))
* Project portable map selections ([046a01d](https://github.com/LasVegasForTransit/transit-mapper/commit/046a01dfbb32827189234b263d31cc39ae0fd1fb))
* **pwa:** Keep adaptive asset fixtures current ([e469cff](https://github.com/LasVegasForTransit/transit-mapper/commit/e469cff4b8254d8dc77d8c043b05a87a289f6195))
* **pwa:** Keep installed editor releases loadable ([b0d79f7](https://github.com/LasVegasForTransit/transit-mapper/commit/b0d79f75a9fdc006e3c81c3dcb7ca665839a740c))
* **pwa:** Precache the deferred editor runtime ([b05aa38](https://github.com/LasVegasForTransit/transit-mapper/commit/b05aa38c43824bc87e77c5e1a2a0999fa4a631d4))
* **renderer:** Keep large maps moving between paints ([30800e6](https://github.com/LasVegasForTransit/transit-mapper/commit/30800e6bd646057e2779d5b7fc42cde80d9fffdb))
* **renderer:** Keep transit visible across basemap changes ([529d38d](https://github.com/LasVegasForTransit/transit-mapper/commit/529d38d27c68cc2d9951df68ddf139ff5505e1a3))
* **renderer:** Wait for document data before building the map ([3bea6ff](https://github.com/LasVegasForTransit/transit-mapper/commit/3bea6ffd2ead04dded3d1372a45e8177f72632b7))
* Replace stale layers when representations change ([68bee02](https://github.com/LasVegasForTransit/transit-mapper/commit/68bee02e51b972280aa07ff844d5480728260931))
* Restore reusable workspace layout contracts ([b0148a1](https://github.com/LasVegasForTransit/transit-mapper/commit/b0148a103e201e54829013f70f52f70db400113e))
* Restore surface state before scene recovery ([78a1bbc](https://github.com/LasVegasForTransit/transit-mapper/commit/78a1bbc91fc67bd7447379c61442e94efee16456))
* Serve published GTFS feeds from managed archives ([f69a5f4](https://github.com/LasVegasForTransit/transit-mapper/commit/f69a5f489d4e467c28350c5c4a9ca6c850d806ca))
* **web:** Always queue the first ready scene ([1ab0c7f](https://github.com/LasVegasForTransit/transit-mapper/commit/1ab0c7fbdf023418821dcb709c3e61b0e957bead))
* **web:** Avoid duplicate initial renderer work after bootstrap ([482646c](https://github.com/LasVegasForTransit/transit-mapper/commit/482646c2e5c211d51545c96fd591a32df23637aa))
* **web:** Defer fallback projection until bootstrap finishes ([a64018f](https://github.com/LasVegasForTransit/transit-mapper/commit/a64018f3aa1119d18121b41374ce6f776743d25a))
* **web:** Finish restoring renderer startup responsiveness ([73c2f4b](https://github.com/LasVegasForTransit/transit-mapper/commit/73c2f4b0ecf197d73e5430be5319d2e6bcc096cb))
* **web:** Flush a stalled first renderer frame ([6ac432e](https://github.com/LasVegasForTransit/transit-mapper/commit/6ac432ed359313a471e3440f63680e6af5ec25e3))
* **web:** Give MapLibre a real paint checkpoint ([e65bf78](https://github.com/LasVegasForTransit/transit-mapper/commit/e65bf78c1b4536c8ea6b39ced4abc6470319dd2f))
* **web:** Ignore placeholder requests in initial scene recovery ([1134065](https://github.com/LasVegasForTransit/transit-mapper/commit/1134065a8550893259d492ea8969d6f169e72cf6))
* **web:** Keep completed scene preparation after an overrun ([bf6193f](https://github.com/LasVegasForTransit/transit-mapper/commit/bf6193f69e3dd0ffb8a2c4cdae55d534c14e930e))
* **web:** Keep embed launch checks within one build ([0cbe4b4](https://github.com/LasVegasForTransit/transit-mapper/commit/0cbe4b493a61c7ae2ab020dbaa32148789ea72f8))
* **web:** Keep initial style handling within the lint boundary ([5656771](https://github.com/LasVegasForTransit/transit-mapper/commit/56567713e289a24b3cc47f6a5619cda1d7eeeab5))
* **web:** Keep renderer preparation moving after a missed frame ([ab8594d](https://github.com/LasVegasForTransit/transit-mapper/commit/ab8594dd3ff3063008a5e286c595dbb4694d8345))
* **web:** Keep RTC preparation within the startup window ([67897bc](https://github.com/LasVegasForTransit/transit-mapper/commit/67897bc0507e506ff1c97ab2a0b877f6fb4a62dd))
* **web:** Keep simulation shortcuts available during map startup ([af12b1b](https://github.com/LasVegasForTransit/transit-mapper/commit/af12b1b4cf2bd5c39742d09bbcc1460449d33554))
* **web:** Keep the application shell full-height and eager ([4d80712](https://github.com/LasVegasForTransit/transit-mapper/commit/4d80712f77bcfc0fa143fc52351ec6830059a9d6))
* **web:** Keep the drafting grid after the basemap deadline ([cbe6b04](https://github.com/LasVegasForTransit/transit-mapper/commit/cbe6b04d1f7bdc1de47c26a42cd9d4d8be7bfc16))
* **web:** Keep the loading document out of the renderer ([b6a38b2](https://github.com/LasVegasForTransit/transit-mapper/commit/b6a38b2d144c9b27fdd387223c1909eb02dc624e))
* **web:** Keep the local drafting grid through startup ([95ed02b](https://github.com/LasVegasForTransit/transit-mapper/commit/95ed02b09bb3a0165d410364fc72a0db6f197674))
* **web:** Let renderer tasks yield to MapLibre paint ([02b9eaf](https://github.com/LasVegasForTransit/transit-mapper/commit/02b9eafa2cac367e7fb29db0b9a284981bfa3577))
* **web:** Let viewer launch checks use viewer diagnostics ([020ae54](https://github.com/LasVegasForTransit/transit-mapper/commit/020ae5407c604bfc73927f6251f168bd0a0b8b4f))
* **web:** Make interaction attachment transactional ([5fa7b61](https://github.com/LasVegasForTransit/transit-mapper/commit/5fa7b6147ef84b65cd3f725f77f24a5b81f8ab9e))
* **web:** Mark the accepted scene as the first system paint ([e3ba1f3](https://github.com/LasVegasForTransit/transit-mapper/commit/e3ba1f38c001a6112a3e7d0a3b85d73c7c6a1513))
* **web:** Mount maps before large document bootstrap ([b9be1d2](https://github.com/LasVegasForTransit/transit-mapper/commit/b9be1d24143d6b47ce9971260c8ed6a8e2212f45))
* **web:** Name compact viewer actions ([7906e8e](https://github.com/LasVegasForTransit/transit-mapper/commit/7906e8e30c8b849ebeb483e9c6e7076472ff42a2))
* **web:** Nudge paint without blocking renderer tasks ([55c2c5d](https://github.com/LasVegasForTransit/transit-mapper/commit/55c2c5d57b27ee20590accae163fc18b66af5ef8))
* **web:** Prove viewer camera movement through view links ([1c4b6ba](https://github.com/LasVegasForTransit/transit-mapper/commit/1c4b6ba4b8a0edd63a528bede01b5a94f0095edb))
* **web:** Publish the initial scene after setup races bootstrap ([1ae74f2](https://github.com/LasVegasForTransit/transit-mapper/commit/1ae74f2029ec5cb8425aa7504a812e06c517d2de))
* **web:** Record the first rendered editor scene ([83f16ba](https://github.com/LasVegasForTransit/transit-mapper/commit/83f16ba610cb1c921a13fc53abccbd4957c6069b))
* **web:** Remove the blocking application loader ([7f58318](https://github.com/LasVegasForTransit/transit-mapper/commit/7f58318620bf35872c19303c87b5d56d3750ddca))
* **web:** Retry local map setup after style parsing ([87c05db](https://github.com/LasVegasForTransit/transit-mapper/commit/87c05db1d8a9c831d34b4b1461b7f2335e319720))
* **web:** Retry map setup after style replacement ([e76547b](https://github.com/LasVegasForTransit/transit-mapper/commit/e76547b9c2dcf6cdf6e2080625b7bf22f6d1aa97))
* **web:** Retry overlay recovery after fallback replacement ([b0252cf](https://github.com/LasVegasForTransit/transit-mapper/commit/b0252cf87e18c925ebd214454420dca6f925887a))
* **web:** Reuse one onboarding map ([f272f13](https://github.com/LasVegasForTransit/transit-mapper/commit/f272f1374a8b4683f56f6de638bdf7767af441c6))
* **web:** Settle the startup style before document install ([20c8257](https://github.com/LasVegasForTransit/transit-mapper/commit/20c82577f075dd2a32ace52e75223b14eb4db317))
* **web:** Start stable maps without a style race ([db7b37a](https://github.com/LasVegasForTransit/transit-mapper/commit/db7b37a98615bf59454219edee11c3d018151cb8))
* **web:** Start the editor from the local map fallback ([fdbf9b4](https://github.com/LasVegasForTransit/transit-mapper/commit/fdbf9b43cf40f9faf201cbfb7b4d2340b4d0d2c6))
* **web:** Surface failed scheduler jobs in renderer diagnostics ([460bc90](https://github.com/LasVegasForTransit/transit-mapper/commit/460bc9048f49b6bb0b3d1ca74112831175ead8de))
* **web:** Track the vehicle gate in map effects ([3ae1399](https://github.com/LasVegasForTransit/transit-mapper/commit/3ae139964c9f4d8c3dc90a270c6c033d4f9e1e35))
* **web:** Use surface-owned paint evidence in launch checks ([1d99409](https://github.com/LasVegasForTransit/transit-mapper/commit/1d994094578c064f9f23772f9b8c1088987d1876))
* **web:** Wait for the committed fallback style ([82ec31a](https://github.com/LasVegasForTransit/transit-mapper/commit/82ec31a8318287b396bd09e016c49bea004eb38c))
* **web:** Wait for the shared viewer identity to resolve ([2ca40a0](https://github.com/LasVegasForTransit/transit-mapper/commit/2ca40a0cc8e546c20542caed76ce7c3ca12488af))
* **worker:** Run verification without built packages ([6ba088c](https://github.com/LasVegasForTransit/transit-mapper/commit/6ba088ca6b5765eb53e117bb80d097e744d45013))

## [0.6.1](https://github.com/LasVegasForTransit/transit-mapper/compare/v0.6.0...v0.6.1) (2026-08-16)


### Bug Fixes

* **web:** Move hide-interface control off the app menu ([ebe4749](https://github.com/LasVegasForTransit/transit-mapper/commit/ebe47499bcc3c3a75dc945cff4ee71c702e1efb7))
* **web:** Stop calling a slow basemap a broken one ([#108](https://github.com/LasVegasForTransit/transit-mapper/issues/108)) ([f7f2631](https://github.com/LasVegasForTransit/transit-mapper/commit/f7f26316d74da452229dcf2b6ddf8f608a6ffa36))

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
