const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
const firefox = require('selenium-webdriver/firefox')

class DeepL {
    constructor () {
        this.URL = 'https://www.deepl.com/translator'

        this.driver = null

        this.languages = []
    }

    async init() {
        this.driver = await new Builder()
            .forBrowser('firefox')
            .setFirefoxOptions(
                new firefox.Options()
                    // .headless()
                )
            .build()
        // this.manage = this.driver.manage()
    }

    async run() {
        await this.init()
        await this.driver.get(this.URL)
        // this.languages = await Promise.all((await this.driver.findElements(By.css('.lmt__language_select__menu:first-child button'))).map(async x => (await x.getAttribute('dl-lang')).toLowerCase()))
        this.languages = await Promise.all((await (await this.driver.findElement(By.css('.lmt__language_select__menu'))).findElements(By.css('button'))).map(async x => (await x.getAttribute('dl-lang')).toLowerCase()))
        // this.languages = await Promise.all((await this.driver.findElements(By.xpath('//div[@class=lmt__language_select__menu][1]/button'))).map(async x => (await x.getAttribute('dl-lang')).toLowerCase()))
    }

    async setLanguages(options) {
        if (options.in || options.out) {
            const languageSelect = await this.driver.findElements(By.css('.lmt__language_select__menu'))
            if (options.in && this.languages.includes(options.in)) {
                // this.driver.executeScript('document.querySelectorAll(".lmt__language_select.lmt__language_select--source").')
                // await languageSelect[0].click();
                const element = (await languageSelect[0].findElement(By.css(`button[dl-lang=${options.in == 'auto' ? options.in : options.in.toUpperCase()}`)))
                await this.driver.executeScript('arguments[0].click()', element)
                // await (await this.driver.findElement(By.css('.lmt__language_select.lmt__language_select--source'))).sendKeys('dl-selected-lang', options.in != 'auto' ? `${options.in.toLowerCase()}-${options.in.toUpperCase()}` : '')
            }
            if (options.out && this.languages.includes(options.out)) {
                if (options.out != 'auto') {
                    // await languageSelect[1].click();
                    const element = (await languageSelect[1].findElement(By.css(`button[dl-lang=${options.out.toUpperCase()}`)))
                    await this.driver.executeScript('arguments[0].click()', element)
                }
                // await (await this.driver.findElement(By.css('.lmt__language_select.lmt__language_select--target'))).sendKeys('dl-selected-lang', options.out != 'auto' ? `${options.out.toLowerCase()}-${options.out.toUpperCase()}`: '')
            }
        }
    }

    async translate(str, options) {
        // console.log(this.languages)
        if (options && options.langs) {
            this.setLanguages(options.langs)
        }

        const [input, output] = await this.driver.findElements(By.css('.lmt__textarea'))
        const status = await this.driver.findElement(By.css('#dl_translator'))

        await input.clear()
        // const variants = await this.driver.findElements(By.css('.lmt__translations_as_text__text_btn'))

        await input.sendKeys(str)
        // await input.sendKeys(str, Key.RETURN)
        await this.driver.wait(async () => (await output.getAttribute('value')).trim() != '' && !(await status.getAttribute('class')).includes('lmt--active_translation_request'), 20000)
        // await this.driver.wait(async () => {
        //     const out = await this.driver.findElements(By.css('.lmt__textarea'))
        //     // console.log(await out[1].getAttribute('value'))
        //     return (await out[1].getAttribute('value')).trim() != ''
        // }, 20000)

        const translation = {
            translate: await output.getAttribute('value'),
            variants:
                (await Promise.all(
                    (await this.driver.findElements(By.css('.lmt__translations_as_text__text_btn')))
                        .map(
                            async x => await x.getText()
                            )
                    )
                )
                .slice(1),
        }

        return translation
        // return await (await this.driver.findElements(By.css('.lmt__textarea')))[1].getAttribute('value')
    }
}


;(async () => {
    let deep = null;
    try {
        deep = new DeepL()
        await deep.run()
        const trans = await deep.translate('俺大きなちんちんありますですから、ちょっと吸うしなさい。。。')
        console.log(trans)
        console.log(await deep.translate(trans.translate, {
            langs: {
                // in: 'ru',
                out: 'zh'
            }
        }))
        // await deep.
        await deep.driver.quit()
    } catch (e) {
        console.error(e)
        if (deep)
            await deep.driver.quit()
    }
})()

// deep.driver.quit()