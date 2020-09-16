const { By, until } = require('selenium-webdriver')
const readline = require('readline');
const path = require('path')
const fs = require('fs').promises
const RuCaptcha2Captcha = require('rucaptcha-2captcha');

const { captchaApiKey } = require('./config')

const AstractParser = require('./AbstractParser')

class YandexMarketParser extends AstractParser {

    constructor() {
        super()
        this.SITE = 'market.yandex.ru'
        this.CAPTCHA = {
            imageElement: By.css('.captcha__image img'),
            inputElement: By.css('.input-wrapper__content'),
            submitElement: By.css('.submit')
        }

        this.captchaSolver = new RuCaptcha2Captcha(captchaApiKey);
    }

    async run() {
        await super.run()

        if (this.categories.length == 0) {
            console.log('No categories for parse')
        } else {
            console.log('Categories count: ', this.categories.length)
        }

        // Any categories for parsing?
        if (this.categories[0]) {
            this.last_page = this.categories[0].last_page
            this.last_product_url = this.categories[0].last_product_url
            console.log('Last page ' + this.last_page)
            console.log('Last product ' + this.last_product_url)
        }
        for (this.currentCategory of this.categories) {

            await this.driver.get(this.currentCategory.url)
            await this.processCaptcha()

            // const onStock = await this.driver.findElement(By.css('#onstock'))
            // await this.driver.wait(until.elementIsEnabled(onStock), 20000)
            // await this.driver.executeScript('arguments[0].click()', onStock)

            let totalModels = 1
            let pageAmount = 1

            await this.driver.wait(async () => {

                let pageSource = await this.driver.getPageSource()

                if (pageSource.includes('total')) {
                    totalModels = parseInt(pageSource.slice(pageSource.indexOf('total') + 'total'.length + 2))
                    pageAmount = Math.ceil(totalModels / 48)
                }

                console.log(pageSource.includes('total'), pageSource.length)
    
                return pageSource.includes('total')
            })

            console.log(`Total models: ${totalModels}, page amount: ${pageAmount}`)

            const count_pages = pageAmount
            console.log('Total page count: ' + count_pages)

            for (let page = this.last_page ? this.last_page : 1; page < count_pages; page++) {
                //update last page
                //this.last_page = (
                await this.updateEntity('sites', { last_page: page }, { name: this.SITE }).last_page

                await this.driver.get(`${this.currentCategory.url}${this.currentCategory.url.includes('?') ? '&' : '?'}page=${page}`)
                await this.processCaptcha()
                console.log('New page parse: ' + page)
                await this.parsePage()
            }
            await this.updateEntity('categories', { parsing: false }, { url: this.currentCategory.url })

        }

        await this.stop()
    }

    async parsePage() {
        const productLinks = await this.driver.findElements(By.css('[data-zone-name=title] a'))

        console.log('productLinks length', productLinks.length)
        
        const productUrls = []
        
        // Extraction of urls
        let f = !this.last_product_url
        for (const productLink of productLinks) {
            const url = (await productLink.getAttribute('href')).split('?').shift()
            if (!f) {
                if (url === this.last_product_url) {
                    f = true
                    productUrls.push(url)
                    
                    // we must reset last product url or program will fail on the next page
                    this.last_product_url = false
                }
            }
            else {
                productUrls.push(url)
            }
        }

        console.log('productUrls length', productUrls.length)
        
        for (const product_url of productUrls) {
            await this.pause()
            //this.last_product_url = (
            await this.updateEntity('sites',
                { last_product_url: product_url }, { name: this.SITE }).last_product_url
            await this.driver.get(product_url)
            await this.processCaptcha()
            await this.parseProduct()
        }
    }

    async parseProduct() {
        let url = await this.driver.getCurrentUrl()
        if (url.includes('?'))
            url = url.slice(0, url.indexOf('?'))

        console.log('Parse new product: ', url)

        let product = await this.getEntity('products', { url })

        if (product) {
            this.currentProduct = product
            console.log('This product is already in the db.')

            await this.driver.get(`${url}/reviews`)
            await this.processCaptcha()
        }
        else {
            product = {}
            product.category_id = this.currentCategory.id
            product.url = url

            await this.driver.get(`${url}/spec`)
            await this.processCaptcha()
            try {
                const h1Element = await this.driver.findElement(By.css('h1'))
                product.name = await h1Element.getText()
            }
            catch (e) {
                console.log('Error while getting product name')
            }

            product.spec = {}

            const detailElementsKeys = await this.driver.findElements(By.css('dt'))
            const detailElementsValues = await this.driver.findElements(By.css('dd'))

            for (let i = 0; i < detailElementsKeys.length; i++) {
                const [nameElement, valueElement] = [detailElementsKeys[i], detailElementsValues[i]]
                // const valueElement = await detailElement.findElement(By.css('a'))

                const name = (await nameElement.getText()).trim()
                const value = (await valueElement.getText()).trim()

                if (product.spec[name]) {
                    if (product.spec[name] instanceof Array)
                        product.spec[name] = [...product.spec[name], value]
                    else
                        product.spec[name] = [product.spec[name], value]
                }
                else
                    product.spec[name] = value
            }

            this.currentProduct = await this.saveEntity('products', product)

            // await this.driver.navigate().back()
            await this.driver.get(`${url}/reviews`)
            await this.processCaptcha()
        }

        /* console.log('currentProduct', this.currentProduct)
        console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++') */

        let countFeedbackPages = 1

        try {
            let numberOfReviews = await this.driver.findElement(By.xpath('/html/body/div[2]/div[5]/div[4]/div/div/div/ul/li[5]/div/a/span[2]'))
            numberOfReviews = +(await numberOfReviews.getText())
            countFeedbackPages = Math.ceil(numberOfReviews / 10)
            console.log('numberOfReviews', numberOfReviews, 'numberOfReviewPages', countFeedbackPages)
        } catch { }

        let feedbackUrls = []

        const baseFeedbackUrl = (await this.driver.getCurrentUrl()).split('?').shift()

        for (let page = 1; page < countFeedbackPages + 1; page++) {

            const feedbackDatas = await this.driver.findElements(By.css('[data-zone-name=product-review]'))

            // last_feedback_url is reviewId number, because YandexMarket doesn't have direct links to the reviews
            let f = !this.last_feedback_url
            for (const feedbackData of feedbackDatas) {
                const reviewId = JSON.parse(await feedbackData.getAttribute('data-zone-data')).reviewId
                if (!f) {
                    if (reviewId === this.last_feedback_url) {
                        f = true
                        feedbackUrls.push(reviewId)

                        await this.parseFeedback(feedbackData, reviewId)
                        await this.updateEntity('sites', { last_feedback_url: reviewId },
                            { name: this.SITE }).last_feedback_url

                        this.last_feedback_url = false
                    }
                }
                else {
                    feedbackUrls.push(reviewId)

                    await this.parseFeedback(feedbackData, reviewId)
                    await this.updateEntity('sites', { last_feedback_url: reviewId },
                        { name: this.SITE }).last_feedback_url
                }
            }
            console.log(`Feedbacks on page ${page}:`, feedbackUrls)
            feedbackUrls = []

            if (page < countFeedbackPages) {
                await this.pause()
                await this.driver.get(`${baseFeedbackUrl}/?page=${page + 1}`)
                await this.processCaptcha()
            }
        }
    }

    async parseFeedback(schemaData, url) {
        //TODO: parse review pages
        //If url is set test mode is running
        const originalSchema = schemaData
        if (url === '') {
            url = await this.driver.getCurrentUrl()
        }
        let feedback = await this.getEntity('feedbacks', { url })

        if (feedback) {
            this.currentFeedback = feedback
        }
        else {
            feedback = {}

            // url
            // feedback.url = await this.driver.getCurrentUrl()
            feedback.url = url

            // product_id
            feedback.product_id = this.currentProduct.id

            schemaData = schemaData.findElement(By.css('[itemprop=review]'))

            // title - none
            // try {
            // }
            // catch{ }

            // score
            try {
                const starsElement = await schemaData.findElement(By.css('[itemprop=ratingValue]'))
                feedback.score = +(await starsElement.getAttribute('content'))
            }
            catch{ }

            // content
            try {
                let content = ''
                const description = await (await schemaData.findElement(By.css('[itemprop="description"]'))).getAttribute('content')

                if (description.includes('Комментарий: ')) {
                    content = description.split('Комментарий: ').pop().trim() // last element

                    if (content && content !== '&nbsp;') {
                        feedback.content = content
                    }
                }
            }
            catch{ }

            // likes and dislikes
            try {
                const likesElement = (await originalSchema.findElements(By.css('button>span>span'))).slice(0, 2)

                feedback.likes = +((await likesElement[0].getText()).trim())
                feedback.dislikes = +((await likesElement[1].getText()).trim())
            } catch { }

            // experience
            try {
                const experienceElement = await originalSchema.findElement(By.css('[data-rate] + span'));
                feedback.experience = (await experienceElement.getText()).split('Опыт использования: ').pop().trim()
            }
            catch{ }

            // published_at
            try {
                const publishedAtElement = await schemaData.findElement(By.css('[itemprop=datePublished]'))
                feedback.published_at = new Date(await publishedAtElement.getAttribute('content')).toISOString()
            }
            catch{ }

            // embed - none
            // try {
            // }
            // catch{ }
            
            // author_name
            try {
                const authorElement = await schemaData.findElement(By.css('[itemprop=author]'))
                feedback.author_name = await authorElement.getAttribute('content')
            }
            catch{ }

            // recommend - none
            // try {
            // }
            // catch{ }

            // author_respect
            try {
                const respectElement = await originalSchema.findElements(By.css('div>div>span>span'))
                if (respectElement.length > 0)
                    feedback.author_respect = +((await respectElement[0].getText()) == 'Проверенный покупатель')
                else
                    feedback.author_respect = 0
            }
            catch{ }

            console.log('feedback', feedback)
            //console.log('feedback_url', feedback.url)
            console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++')

            this.currentFeedback = await this.saveEntity('feedbacks', feedback)

            // photo
            try {
                // [...document.querySelectorAll('[data-zone-name="product-review"] [data-zone-name="product-review-photos"]')[6].querySelectorAll('div>picture>img')]
                const urls = []
                const imgElements = await originalSchema.findElements(By.css('[data-zone-name=product-review-photos] div>picture>img'))
                for (const imgElement of imgElements.slice(0, Math.floor(imgElements.length / 2))) {
                    const url = await imgElement.getAttribute('src')
                    urls.push(url)
                }
                urls.length && await this.savePhotos(urls)

                console.log('Count of photos: ' + urls.length)
            } catch {
                console.log('Error while saving photos')
            }

            // benefits and shortcomings
            try {
                const description = await (await schemaData.findElement(By.css('[itemprop="description"]'))).getAttribute('content')
                // if (benefitElement[0]) {
                const benefits = []

                // console.log('description length', description.length)
                let content = description.split('Недостатки: ')
                if (description.includes('Недостатки: ')) {
                    content.pop().split('Комментарий: ').shift().trim().split('\n').forEach(contentChunk => {
                        benefits.push({ content: contentChunk, type: false, feedback_id: this.currentFeedback.id })
                    })
                    content = description.split('Недостатки: ')
                }
                if (description.includes('Достоинства: ')) {
                    content.shift().split('Достоинства: ').pop().trim().split('\n').forEach(contentChunk => {
                        benefits.push({ content: contentChunk, type: true, feedback_id: this.currentFeedback.id })
                    })
                }
                benefits.length && await this.saveMany('benefits_shortcomings', benefits)

                console.log('Benefits and shortcomings: ', benefits)
            }
            catch (e) {
                console.log('Error benefits or shortcomings: ' + e)
            }
        }
    }

    async processCaptcha(nextCheck = false, captchaParams, imageToSave) {
        const captchaPage = await this.checkCaptcha()
        if (captchaPage) {
            if (nextCheck) {
                console.log('Captcha was solved incorrectly:', captchaParams.token);
                await captchaParams.tokenIsBad()
            }

            const captchaImage = (await this.driver.findElements(this.CAPTCHA.imageElement))[0]
            const image = await captchaImage.takeScreenshot()

            try {
                const { token, tokenIsGood, tokenIsBad } = await this.solveCaptcha(image)
    
                console.log(`We got answer to the captcha: ${token}.`)
    
                const captchaInput = (await this.driver.findElements(this.CAPTCHA.inputElement))[0]
                const captchaSubmit = (await this.driver.findElements(this.CAPTCHA.submitElement))[0]
                await captchaInput.sendKeys(token.trim())
                await captchaSubmit.click()
    
                await this.processCaptcha(true, { token, tokenIsGood, tokenIsBad }, image)
            } catch (e) {
                console.log('Captcha is unsolvable, retrying with page reload...\n', e)
                await this.driver.navigate().refresh()
                await this.processCaptcha()
            }
        } else {
            if (nextCheck) {
                console.log('Captcha was solved correctly:', captchaParams.token);
                await captchaParams.tokenIsGood();

                const savePath = path.join(__dirname, 'captcha', this.SITE, `${captchaParams.token}.png`)

                await fs.mkdir(path.join(__dirname, 'captcha', this.SITE), { recursive: true })

                try {
                    await fs.writeFile(savePath, imageToSave, 'base64', (err) => {
                        if (err)
                            console.log(err);
                        else
                            console.log('Screenshot is saved.')
                    });
                } catch (e) {
                    console.log('Captcha contains forbidden character(s), it couldn\'t be saved on the disk.\n', e)
                }
            }
        }
    }

    async checkCaptcha() {
        const captchaInput = (await this.driver.findElements(this.CAPTCHA.inputElement))[0];
        if (captchaInput) {
            console.log('We got a captcha...')
        }
        return !!captchaInput
    }
    
    async solveCaptcha(image) {
        return await this.captchaSolver.solve({
            method: 'base64',
            body: image,
            // regsense: 1,  // for case-sensitive
            // numeric: 4,   // for both numbers and letters
            // min_len: 5,
            // max_len: 5,   // for exactly 5 symbols
            // language: 2,  // for Roman alphabet
        })
    }
}

function run_parser() {
    const parser = new YandexMarketParser()

    parser.run().catch(e => {
        parser.errorLog(e)
        parser.stop()

        // Trying to re run
        setTimeout(run_parser, 60000)
    })
}

run_parser()