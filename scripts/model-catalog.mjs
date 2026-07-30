const file = (fileName, location, size, hash) => ({
  fileName,
  location,
  size,
  hash,
});

export const MODEL_CATALOG = {
  ja: {
    sourceLanguage: "en",
    targetLanguage: "ja",
    version: "2.3",
    files: {
      model: file("model.enja.intgemm.alphas.bin", "main-workspace/translations-models/4e19636e-4644-4072-8a05-9ef695d4a3ae.bin", 43_849_787, "59ae659f9bb63e4f81f474fe3c03d3f4499434b5f9e779fab7c12a45f31fd562"),
      lex: file("lex.50.50.enja.s2t.bin", "main-workspace/translations-models/87258444-8fac-4d3c-a175-9275e9d10ffa.bin", 4_128_360, "edfb7eb47b98a2689b804ab3614c31b24f1257aa54b1154da3d85e1ae8152d9f"),
      srcvocab: file("srcvocab.enja.spm", "main-workspace/translations-models/cdea5422-fe0d-4941-a653-ca090423e8f8.spm", 796_275, "970c98d174fc01e0339fbabbf45af36a4be3f26f819ec1a5ea1189f71e091889"),
      trgvocab: file("trgvocab.enja.spm", "main-workspace/translations-models/5c1a663f-5736-4100-b681-c6737fe79cb5.spm", 827_144, "3b3d9f8f3a034d98d0a476f1794fa79c01e4e98a967ceb6777a66ba2d03ec1e1"),
    },
  },
  ko: {
    sourceLanguage: "en",
    targetLanguage: "ko",
    version: "2.0",
    files: {
      model: file("model.enko.intgemm.alphas.bin", "main-workspace/translations-models/4041be52-9e75-41f1-9d4f-04801f112553.bin", 59_504_955, "1c310a79b61b8824b2eb26b045db043d92722f3e66ea06998f7c89f48da9f6bc"),
      lex: file("lex.50.50.enko.s2t.bin", "main-workspace/translations-models/f8a94a6b-264c-4c06-8016-2b57364fbd90.bin", 6_676_356, "7734265822ce315c72334ad538e698ab3900ab8e8f04bd43768d0aecad6b6df7"),
      vocab: file("vocab.enko.spm", "main-workspace/translations-models/2143a895-2f68-4f00-8ebc-40c9563f304d.spm", 1_406_926, "709bf0e425345e0e92ce41ed84348a1296a2107c92bdb6624404450ffecbd1f9"),
    },
  },
  "zh-Hans": {
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
    version: "2.2",
    files: {
      model: file("model.enzh.intgemm.alphas.bin", "main-workspace/translations-models/a7ff7d5e-e67e-406c-a34b-a7edea35b10e.bin", 43_849_787, "4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c"),
      lex: file("lex.50.50.enzh.s2t.bin", "main-workspace/translations-models/da8fccc0-31df-4665-9703-96d36606e019.bin", 6_506_248, "4a5e5827788060f1d718a8132b69440929387514a045796e9b77f935db68c055"),
      srcvocab: file("srcvocab.enzh.spm", "main-workspace/translations-models/ea98c52c-58dc-45d5-af23-38f2b029d020.spm", 806_952, "bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5"),
      trgvocab: file("trgvocab.enzh.spm", "main-workspace/translations-models/bddbda68-d4d2-4317-a0a1-119caa47525e.spm", 772_004, "aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d"),
    },
  },
  "zh-Hant": {
    sourceLanguage: "en",
    targetLanguage: "zh-Hant",
    version: "2.0",
    files: {
      model: file("model.enzh.intgemm.alphas.bin", "main-workspace/translations-models/20260522194155--76d2a34e-7ef2-4829-ac1a-a1319b852dc5--72be7771-db83-4218-bec5-44f021cbf00b.bin", 43_849_787, "559ab90d723a58c1f1e2ab7cc12137bc667af5ba3e325e3eb30b5cdc930db520"),
      lex: file("lex.50.50.enzh.s2t.bin", "main-workspace/translations-models/20260522194159--13a8d548-8d6a-46f6-ab8d-ea19098b7fe8--6cf4bdcb-dbe5-4e2d-af40-a02b440fdcc9.bin", 4_057_188, "d891404d1436a7334df12539fe30a26f9e9f2b80bd42fdb8b5f8849e8a1e942b"),
      srcvocab: file("srcvocab.enzh.spm", "main-workspace/translations-models/20260522194144--b93467f8-2c0b-43f4-a662-19cae5c7f899--ae44a945-6ed0-44d2-88ac-d4b9c25f6c3a.spm", 803_694, "2266df70492162a249ab1c0154f929bd6098b246544c666c1a0d5a24dde7d2ea"),
      trgvocab: file("trgvocab.enzh.spm", "main-workspace/translations-models/20260522194157--52f509a0-ac8b-48bf-ba9f-0c61a064a00a--85418cc0-208e-440b-ac6f-c56d242ca430.spm", 751_671, "22b91a4436d70b91ab8777c677252ab5fae2bc284d71f977df5206c110e3444c"),
    },
  },
  de: {
    sourceLanguage: "en",
    targetLanguage: "de",
    version: "2.1",
    files: {
      model: file("model.ende.intgemm.alphas.bin", "main-workspace/translations-models/23db71e7-b6d9-45eb-a47d-0290d7d8ef63.bin", 31_561_787, "8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f"),
      lex: file("lex.50.50.ende.s2t.bin", "main-workspace/translations-models/bc072b1a-7749-43f7-9fe0-34a6dff10c4a.bin", 4_347_672, "7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393"),
      vocab: file("vocab.ende.spm", "main-workspace/translations-models/261225ea-5a52-455b-981c-7d09c6e6da3c.spm", 810_073, "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c"),
    },
  },
  es: {
    sourceLanguage: "en",
    targetLanguage: "es",
    version: "2.1",
    files: {
      model: file("model.enes.intgemm.alphas.bin", "main-workspace/translations-models/a4ba0e94-16de-4058-9a44-5bbbbb3c8640.bin", 31_561_787, "3b1c399511c01c84c36fae5c0524df44096288efdc8236e182b5c97d7ad2244c"),
      lex: file("lex.50.50.enes.s2t.bin", "main-workspace/translations-models/1834a61e-0331-4c4a-bbc0-dda02afa8188.bin", 4_198_436, "7d51237c0a07027dcd61643cfbbb0f8c48597d19907ef53d2cae9d6bec2cf25c"),
      vocab: file("vocab.enes.spm", "main-workspace/translations-models/170634fd-511a-4a28-b723-0a1025c67feb.spm", 816_054, "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad"),
    },
  },
  fr: {
    sourceLanguage: "en",
    targetLanguage: "fr",
    version: "2.0",
    files: {
      model: file("model.enfr.intgemm.alphas.bin", "main-workspace/translations-models/e0d7f3ee-163a-4b0a-8e44-8b208b39477d.bin", 31_561_787, "6322e296d4fecfe395a8d5723da4ec37ecbe6d7613bb1dfcf4b28e2a47498b68"),
      lex: file("lex.50.50.enfr.s2t.bin", "main-workspace/translations-models/293d1823-ff05-48c9-837b-cff8fd33f197.bin", 4_372_936, "2585ed98d3af0bc949865aedeb390493d591f56870814376e73e4144c41ed059"),
      vocab: file("vocab.enfr.spm", "main-workspace/translations-models/c7c1bcf3-71f6-425a-a6ed-403bd9a0a759.spm", 814_404, "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a"),
    },
  },
  pt: {
    sourceLanguage: "en",
    targetLanguage: "pt",
    version: "2.1",
    files: {
      model: file("model.enpt.intgemm.alphas.bin", "main-workspace/translations-models/357d1004-e004-4f93-bbb5-b6b90641e9b4.bin", 31_561_787, "07892fd2544ee79dcb643615d8f2debb9793fae16842e87c328e27a3dd26a770"),
      lex: file("lex.50.50.enpt.s2t.bin", "main-workspace/translations-models/c4192576-e76a-4edc-9346-1f90af10f6ae.bin", 3_970_340, "ccb4c31c9e1899d77a200e71a86958e6ef6c8649627d0bbf3f873b57d9f236bd"),
      vocab: file("vocab.enpt.spm", "main-workspace/translations-models/e5688e52-a5c1-458b-9dbb-459fdcec0b7d.spm", 816_726, "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def"),
    },
  },
  ru: {
    sourceLanguage: "en",
    targetLanguage: "ru",
    version: "2.0",
    files: {
      model: file("model.enru.intgemm.alphas.bin", "main-workspace/translations-models/a6257317-71eb-4ca0-83ce-279c77f7b613.bin", 42_992_955, "0ef9a209c5edc46692750e7505b3695655b1c7c3ec73058b641201ef18c481ce"),
      lex: file("lex.50.50.enru.s2t.bin", "main-workspace/translations-models/bec0fc43-6cb1-4e63-a37f-7f6653fdda77.bin", 2_768_468, "3587f93c10c1d457f874c2ba7ff4d5e2686fdaf7f3fd179cfefeacab3c6990b9"),
      vocab: file("vocab.enru.spm", "main-workspace/translations-models/fcd0f93e-defa-4990-9592-370fb368e81d.spm", 904_455, "56ee63e14e8cb926c394242adc3ed7cc602644c3d33058cff2ce2959d52a6258"),
    },
  },
  it: {
    sourceLanguage: "en",
    targetLanguage: "it",
    version: "2.1",
    files: {
      model: file("model.enit.intgemm.alphas.bin", "main-workspace/translations-models/29ae0d70-5e37-49e8-8da6-3e2c58da61d1.bin", 31_561_787, "248f47568788ecc351da7e5e07064d4153b4f71e011364ae2c931ffeec4d1cc2"),
      lex: file("lex.50.50.enit.s2t.bin", "main-workspace/translations-models/3730ff60-2291-4c87-888d-2dc4593b20db.bin", 4_133_192, "8b21914804625b2777dae7fdb636eb78f02a3eb8b7bceaa50f29ac740961da93"),
      vocab: file("vocab.enit.spm", "main-workspace/translations-models/d9d5ffa9-b919-4491-9ab6-3dec34459768.spm", 812_724, "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5"),
    },
  },
  "ja-en": {
    sourceLanguage: "ja",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.jaen.intgemm.alphas.bin", "main-workspace/translations-models/48d2ba29-c156-44b6-be26-d7ae1192a01b.bin", 59_504_955, "a9bf800679bba570520e1161d7b4fbfcb957add32ca35812134add85689752ad"),
      lex: file("lex.50.50.jaen.s2t.bin", "main-workspace/translations-models/3531750e-147d-444f-b75f-dd077904aaa8.bin", 9_346_816, "8f858a72fcbaa476c582577b04d6f5f89d645d2335b0b4a794c2706d4b1f75ff"),
      vocab: file("vocab.jaen.spm", "main-workspace/translations-models/ca178452-791a-489e-ba83-b90b9bfe6665.spm", 1_443_222, "5cb217758bae05877bb3f0c2f612e4e7c1e4cb03c10db11f4a47098d7ae62919"),
    },
  },
  "ko-en": {
    sourceLanguage: "ko",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.koen.intgemm.alphas.bin", "main-workspace/translations-models/df186f1f-866e-4a67-af59-6470c3677938.bin", 59_504_955, "1c902d6f7a8d7e3efe6ff4f7d4960a369957bca4ce2ce4a6e8572c231d525090"),
      lex: file("lex.50.50.koen.s2t.bin", "main-workspace/translations-models/9256bedc-fb5d-4a9c-8a20-476fc246a7cb.bin", 8_617_080, "471cd980c4ba08c240246f9361f64eb5d627848a135b5731d665f9efaa1e26ae"),
      vocab: file("vocab.koen.spm", "main-workspace/translations-models/b82773e2-0043-4160-86de-310155d111fb.spm", 1_410_063, "1c72b740ab793cdc3a8f16913dd6b4e806c77421077dd2d85edeb7be38418598"),
    },
  },
  "zh-Hans-en": {
    sourceLanguage: "zh-Hans",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.zhen.intgemm.alphas.bin", "main-workspace/translations-models/052699bf-6f88-4c74-bb14-e49a943b4f59.bin", 59_504_955, "3535442962ec8f4a553cc19b206befcac689ee9cddaea44fa91e21527fc30ac2"),
      lex: file("lex.50.50.zhen.s2t.bin", "main-workspace/translations-models/645c720c-6920-470d-9bb7-3f9a6b0a9cae.bin", 9_220_016, "cdcad3592dc2bc4676c34c4d37203f7649ee989195cf083cbb60f1ea011f976b"),
      vocab: file("vocab.zhen.spm", "main-workspace/translations-models/88a4925d-ff4a-4c76-8813-95e2ac600b14.spm", 1_359_697, "dff594318ab7d8b7b60b844ab98ebe6b932ae8045fab15235404c787715965b3"),
    },
  },
  "zh-Hant-en": {
    sourceLanguage: "zh-Hant",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.zhen.intgemm.alphas.bin", "main-workspace/translations-models/20260522194230--6ca6db97-6bce-4110-981f-350e15965675--8323efd2-43e9-4886-9f60-35870d1744ea.bin", 43_849_787, "0aee91790894458f5d367551f6edcd4c9cb97852c34f221bcbf9f4701ebcf0cd"),
      lex: file("lex.50.50.zhen.s2t.bin", "main-workspace/translations-models/20260522194215--6c386193-432a-422f-be5f-3cad0977e52b--a52e4a54-5f80-43ce-b873-1bc792ec1483.bin", 6_385_944, "aa7daf6cfc85c0cd2c10e2944d66f6da55497c9c6408789f3adfded4074c2fb1"),
      srcvocab: file("srcvocab.zhen.spm", "main-workspace/translations-models/20260522194213--ad6a9ed2-06ed-4c72-b6ba-aa4492bd582f--72fab356-41da-4bd6-a22c-aa5456ba3ea1.spm", 769_669, "5cc6a76611dbf86219f109141533606b15ecb34eee83673bb86b2c16b14734db"),
      trgvocab: file("trgvocab.zhen.spm", "main-workspace/translations-models/20260522194217--5e1d7df1-80a8-4142-ae9d-0ff51b8c2fbc--5e39a274-9805-4d87-a950-39b3d95aac93.spm", 812_572, "7bf002db37c10d3b114cc5588d7fdcb16c57d0fd1e2c34354c22cc9f0b6c3c29"),
    },
  },
  "de-en": {
    sourceLanguage: "de",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.deen.intgemm.alphas.bin", "main-workspace/translations-models/f44b1b1b-9df6-4ece-971e-0e5ce96fae54.bin", 31_561_787, "3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20"),
      lex: file("lex.50.50.deen.s2t.bin", "main-workspace/translations-models/d0e4efcb-6145-43db-a69e-568904cc2925.bin", 4_945_796, "113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010"),
      vocab: file("vocab.deen.spm", "main-workspace/translations-models/8ad4d93e-21e6-4862-81d5-c1c3a7d0767b.spm", 810_073, "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c"),
    },
  },
  "es-en": {
    sourceLanguage: "es",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.esen.intgemm.alphas.bin", "main-workspace/translations-models/d7256ea9-7731-4f15-866c-62998eef93b9.bin", 31_561_787, "4aed7734152ae0045d1a69ae49c86cfda18f53c61f90e95e1d1de1c7c7c3b033"),
      lex: file("lex.50.50.esen.s2t.bin", "main-workspace/translations-models/a55a9cf2-8a8c-4942-a528-91e93d081746.bin", 4_636_248, "e2610211d3b9577d012638fe7e7e74ed7b4b708ce96b9e792e67c282a6492daa"),
      vocab: file("vocab.esen.spm", "main-workspace/translations-models/8695cc3d-7897-4c29-808b-bc983a93d1cd.spm", 816_054, "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad"),
    },
  },
  "fr-en": {
    sourceLanguage: "fr",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.fren.intgemm.alphas.bin", "main-workspace/translations-models/8ef78b1c-df6c-49fc-8cae-cf8c0c2a6630.bin", 31_561_787, "15f997bc0d13808b0b0fbd0786e684a3c8a52adcd8071844b76123fdacbf2b90"),
      lex: file("lex.50.50.fren.s2t.bin", "main-workspace/translations-models/c4d99496-81bf-480f-b0bb-3aebacdcbe8e.bin", 4_824_120, "87c6752ea908f5f0347c10ac0cf7d80d9c2f4f20c81c90168f3e8230b56d4440"),
      vocab: file("vocab.fren.spm", "main-workspace/translations-models/11ecb9da-60dd-4b39-aa12-27883099294b.spm", 814_404, "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a"),
    },
  },
  "pt-en": {
    sourceLanguage: "pt",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.pten.intgemm.alphas.bin", "main-workspace/translations-models/6a2cb71f-cf08-431a-a4a2-22e450750408.bin", 31_561_787, "7b854f1ec5a485dd33efd7c1bc01dd7d5a57f566957c5e47722af333f0ce9157"),
      lex: file("lex.50.50.pten.s2t.bin", "main-workspace/translations-models/3a6531f9-2ab9-4164-852e-29d5242ceeaa.bin", 4_634_492, "2685d8b6530be92a4db4cc61f15a097eb114552be15cb6c1699e9d2d99d24470"),
      vocab: file("vocab.pten.spm", "main-workspace/translations-models/9f79e7dc-18ca-4ee7-ad79-2935e46b7d9a.spm", 816_726, "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def"),
    },
  },
  "ru-en": {
    sourceLanguage: "ru",
    targetLanguage: "en",
    version: "1.1",
    files: {
      model: file("model.ruen.intgemm.alphas.bin", "main-workspace/translations-models/466ccac8-f8c7-4fee-81ee-477a1f817f1c.bin", 17_141_051, "b1d85c13cfbb05e1d326dd6f0fb5ef270a2011b547450260f96567a93f446c94"),
      lex: file("lex.50.50.ruen.s2t.bin", "main-workspace/translations-models/fe5156a8-ab98-4597-84c5-f1248eda4770.bin", 4_483_844, "f654693577505fd38b1f3d220cdd4ffffbb45afb900a60cf751f0724eadc74e0"),
      vocab: file("vocab.ruen.spm", "main-workspace/translations-models/40916383-0537-4869-992a-6606ee0cfb97.spm", 905_257, "93bdc941b16e523695c319f74778bca9fd8b75a25ad75020cdc98aef74cdc0fc"),
    },
  },
  "it-en": {
    sourceLanguage: "it",
    targetLanguage: "en",
    version: "2.0",
    files: {
      model: file("model.iten.intgemm.alphas.bin", "main-workspace/translations-models/a6e3de84-6612-4546-a4ef-b658ee23ca08.bin", 31_561_787, "21b70978ce2f3b4da7a06b5de86a09abe3acd30b9eee1b2ebb3582b9bad790bf"),
      lex: file("lex.50.50.iten.s2t.bin", "main-workspace/translations-models/122ac310-0f7b-40d5-b49d-bcee81077c85.bin", 4_713_616, "0700d6d70b30490e68ff9deca0b45b80310745b491855bde3a13e1692d0cbce1"),
      vocab: file("vocab.iten.spm", "main-workspace/translations-models/51b5a437-9daa-481e-a9bc-311f2b3f490c.spm", 812_724, "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5"),
    },
  },
};
