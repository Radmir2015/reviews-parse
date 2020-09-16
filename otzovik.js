const { By } = require('selenium-webdriver')
const readline = require('readline');
const path = require('path')
const fs = require('fs').promises
const RuCaptcha2Captcha = require('rucaptcha-2captcha');

const { captchaApiKey } = require('./config')

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const AstractParser = require('./AbstractParser')

class OtzovikParser extends AstractParser {

    constructor() {
        super()
        this.SITE = 'otzovik.com'
        this.CAPTCHA = {
            imageElement: By.css('td img'),
            inputElement: By.css('[name=llllllllllllllllllllllllllllll]'),
            submitElement: By.css('[name=action_capcha_ban]')
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
            
            const pageLinks = await this.driver.findElements(By.css('.pager-item.last.tooltip-top'))
            
            const href = await pageLinks[0].getAttribute('href')
            
            const count_pages = +href.split('/').slice(-2)[0]
            console.log('Total page count: ' + count_pages)
            
            // await this.parsePage()
            
            for (let page = this.last_page ? this.last_page : 1; page < count_pages; page++) {
                //update last page
                //this.last_page = (
                await this.updateEntity('sites', { last_page: page }, { name: this.SITE }).last_page
                
                await this.driver.get(`${this.currentCategory.url}/${page}/`)
                await this.processCaptcha()
                console.log('New page parse: ' + page)
                await this.parsePage()
            }
            await this.updateEntity('categories', { parsing: false }, { url: this.currentCategory.url })

        }

        await this.stop()
    }

    async parsePage() {
        const productLinks = await this.driver.findElements(By.css('.product-name'))

        const productUrls = []

        // Extraction of urls
        let f = !this.last_product_url
        for (const productLink of productLinks) {
            const url = await productLink.getAttribute('href')
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
        const url = await this.driver.getCurrentUrl()
        console.log('Parse new product: ', url)

        let product = await this.getEntity('products', { url })

        if (product) {
            this.currentProduct = product
            console.log('This product is already in the db.')
        }
        else {
            product = {}
            product.category_id = this.currentCategory.id
            product.url = url

            await this.driver.get(`${url}info/`)
            try {
                const h1Element = await this.driver.findElement(By.css('.product-name span'))
                product.name = await h1Element.getText()
            }
            catch (e) {
                console.log('Error while getting product name')
            }

            product.spec = {}

            const detailElements = await this.driver.findElements(By.css('.product-props tr'))

            for (const detailElement of detailElements) {
                const [nameElement, valueElement] = await detailElement.findElements(By.css('td'))
                // const valueElement = await detailElement.findElement(By.css('a'))

                const name = (await nameElement.getText()).trim()
                const value = (await valueElement.getText()).trim()

                product.spec[name] = value
            }

            this.currentProduct = await this.saveEntity('products', product)

            await this.driver.navigate().back()
        }

        /* console.log('currentProduct', this.currentProduct)
        console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++') */

        let countFeedbackPages = 1

        try {
            const lastFeedbackPage = await this.driver.findElement(By.css('.pager-item.last.tooltip-top'))
            countFeedbackPages = +((await lastFeedbackPage.getAttribute('href')).split('/').slice(-2)[0])
        } catch { }

        const feedbackUrls = []

        const baseFeedbackUrl = await this.driver.getCurrentUrl()

        for (let page = 1; page < countFeedbackPages + 1; page++) {

            const feedbackLinks = await this.driver.findElements(By.css('.review-title'))

            let f = !this.last_feedback_url
            for (const feedbackLink of feedbackLinks) {
                const url = await feedbackLink.getAttribute('href')
                if (!f) {
                    if (url === this.last_feedback_url) {
                        f = true
                        feedbackUrls.push(url)
                        this.last_feedback_url = false
                    }
                }
                else {
                    feedbackUrls.push(url)
                }
            }
            console.log(`Feedbacks on page ${page}:`, feedbackUrls)

            if (page < countFeedbackPages) {
                await this.pause()
                await this.driver.get(`${baseFeedbackUrl}${page + 1}/`)
                await this.processCaptcha()
            }
        }

        for (const feedback_url of feedbackUrls) {
            await this.pause()
            // Раньше тут было присвоение, но это ломает логику
            //this.last_feedback_url =
            await this.updateEntity('sites', { last_feedback_url: feedback_url },
                { name: this.SITE }).last_feedback_url
            await this.driver.get(feedback_url)
            await this.processCaptcha()
            await this.parseFeedback()
        }

    }

    async parseFeedback(url = '') {
        //TODO: parse review pages
        //If url is set test mode is running
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
            feedback.url = await this.driver.getCurrentUrl()

            // product_id
            feedback.product_id = this.currentProduct.id

            // title
            try {
                const h2Element = await this.driver.findElement(By.css('.summary'))
                feedback.title = (await h2Element.getText()).trim()
            }
            catch{ }

            // score
            try {
                const starsElement = await this.driver.findElement(By.css('abbr.rating'))
                feedback.score = +(await starsElement.getAttribute('title'))
            }
            catch{ }

            // content
            try {
                let content = ''
                // if has <p> tags
                const paragraphElements = await this.driver.findElements(By.css('.review-body.description p'))
                if (paragraphElements.length) {
                    for (const paragraphElement of paragraphElements) {
                        const text = await paragraphElement.getText()
                        if (text && text !== ' ' && text !== '&nbsp;') {
                            content += ` ${text}`
                        }
                    }
                }
                else {
                    // if no <p> tags
                    const descriptionElement = await this.driver.findElement(By.xpath('//div[@itemprop="description"]'))
                    content += await descriptionElement.getText()
                }
                if (content) {
                    feedback.content = content
                }
            }
            catch{ }

            // likes
            try {
                const likesElement = await this.driver.findElement(By.css('.review-yes'))

                feedback.likes = +(await likesElement.getText()).trim().split(':')[1]
            } catch { }
            // dislikes
            /* const dislikesElement = await this.driver.findElement(By.css('.RecommendRating-dislike span'))
            feedback.dislikes = +(await dislikesElement.getText()).trim() */

            // experience
            try {
                const experienceElement = await this.driver.findElement(By.css('.owning-time'));
                feedback.experience = (await experienceElement.getText()).trim()
            }
            catch{ }


            // published_at
            try {
                const publishedAtElement = await this.driver.findElement(By.css('.dtreviewed .value'))
                feedback.published_at = new Date(await publishedAtElement.getAttribute('title')).toISOString()
                // feedback.published_at = new Date(await publishedAtElement.getAttribute('title')).toISOString().replace('T', ' ').replace('Z', '').replace('.000', '')
            }
            catch{ }

            // embed
            try {
                const embed = {}   
                const ratingElements = await this.driver.findElements(By.css('.review-contents .rating-item.tooltip-top'))
                ratingElements.forEach(async rate => {
                    const title = (await rate.getAttribute('title')).split(': ');
                    embed[title[0].trim()] = +title[1][0]
                })
                feedback.embed = embed
            }
            catch{ }
            
            // author_name
            try {
                const authorElement = await this.driver.findElement(By.css(`.user-login span[itemprop='name']`))
                feedback.author_name = await authorElement.getText()
            }
            catch{ }

            // recommend
            try {
                const recommendElement = await this.driver.findElement(By.css('tr .recommend-ratio'))
                feedback.recommend = (await recommendElement.getText()).slice(0, 2).toLowerCase() === 'да'
                // let text = await recommendElement.getText().trim()
                
                // (await recommendElement.findElements(By.xpath("./*"))).forEach(async child => {
                //     text = text.replace(await child.getText(), '').trim()
                // })
                // feedback.recommend = text.toLowerCase() === 'да'
            }
            catch{ }

            // author_respect
            try {
                const respectElement = await this.driver.findElement(By.css('.karma.karma1'))
                feedback.author_respect = +(await respectElement.getText()).trim()
            }
            catch{ }

            console.log('feedback', feedback)
            //console.log('feedback_url', feedback.url)
            console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++')

            this.currentFeedback = await this.saveEntity('feedbacks', feedback)

            // photo
            try {
                const urls = []
                const imgElements = await this.driver.findElements(By.css('.review-body p img'))
                for (const imgElement of imgElements) {
                    const url = await imgElement.getAttribute('src')
                    urls.push(url)
                }
                urls.length && await this.savePhotos(urls)

                console.log('Count of photos: ' + urls.length)
            } catch {
                console.log('Error while saving photos')
            }

            // benefits
            try {
                const benefitElement = await this.driver.findElements(By.css('.review-plus'))
                if (benefitElement[0]) {
                    const benefits = []
                    // for (const benefitsElement of benefitElements) {
                    const content = (await benefitElement[0].getText()).trim()
                    benefits.push({ content, type: true, feedback_id: this.currentFeedback.id })
                    // }
                    benefits.length && await this.saveMany('benefits_shortcomings', benefits)

                    console.log('Benefits: ', benefits)
                }
            }
            catch (e) {
                console.log('Error benefits: ' + e)
            }

            // shortcoming
            try {
                const shortcomingElement = await this.driver.findElements(By.css('.review-minus'))
                if (shortcomingElement[0]) {
                    const shortcomings = []
                    // for (const shortcomingElement of shortcomingElements) {
                    const content = (await shortcomingElement[0].getText()).trim()
                    shortcomings.push({ content, type: false, feedback_id: this.currentFeedback.id })
                    // }
                    shortcomings.length && await this.saveMany('benefits_shortcomings', shortcomings)

                    console.log('Shortcomings: ', shortcomings)
                }
            }
            catch (e) {
                console.log('Error shortcoming: ', e)
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

            const { token, tokenIsGood, tokenIsBad } = await this.solveCaptcha(image)

            console.log(`We got answer to the captcha: ${token}.`)

            const captchaInput = (await this.driver.findElements(this.CAPTCHA.inputElement))[0]
            const captchaSubmit = (await this.driver.findElements(this.CAPTCHA.submitElement))[0]
            await captchaInput.sendKeys(token.trim())
            await captchaSubmit.click()

            await this.processCaptcha(true, { token, tokenIsGood, tokenIsBad }, image)
        } else {
            if (nextCheck) {
                console.log('Captcha was solved correctly:', captchaParams.token);
                await captchaParams.tokenIsGood();

                const savePath = path.join(__dirname, 'captcha', `${captchaParams.token}.png`)

                await fs.mkdir(path.join(__dirname, 'captcha'), { recursive: true })

                await fs.writeFile(savePath, imageToSave, 'base64', (err) => {
                    if (err)
                        console.log(err);
                    else
                        console.log('Screenshot is saved.')
                });
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
    const parser = new OtzovikParser()

    parser.run().catch(e => {
        parser.errorLog(e)
        parser.stop()

        // Trying to re run
        setTimeout(run_parser, 60000)
    })
}

run_parser()
// module.exports = OtzovikParser