const { By } = require('selenium-webdriver')

const AstractParser = require('./AbstractParser')

class IrecommendParser extends AstractParser {

    constructor() {
        super()
        this.SITE = 'irecommend.ru'
    }

    async run() {
        await super.run()

        if (this.categories.length == 0) {
            console.log('No categories for parse')
        } else {
            console.log('Categories count: ', this.categories.length)
        }

        // Any categories for parsing?
        if(this.categories[0]) {
            this.last_page = this.categories[0].last_page
            this.last_product_url = this.categories[0].last_product_url
            console.log('Last page ' + this.last_page)
            console.log('Last product ' + this.last_product_url)
        }
        for(this.currentCategory of this.categories) {

            await this.driver.get(this.currentCategory.url)

            const pageLinks = await this.driver.findElements(By.css('.pager a'))
            const href = await pageLinks[pageLinks.length - 1].getAttribute('href')

            const count_pages = +href.split('=')[1]
            console.log('Total page count: ' + count_pages)

            // await this.parsePage()

            for(let page = this.last_page ? this.last_page : 1; page < count_pages; page++) {
                //update last page
                //this.last_page = (
                await this.updateEntity('sites', { last_page: page }, { name: this.SITE }).last_page

                await this.driver.get(`${this.currentCategory.url}?page=${page}`)
                console.log('New page parse: ' + page)
                await this.parsePage()
            }
            await this.updateEntity('categories', { parsing: false }, { url: this.currentCategory.url })
            
        }

        await this.stop()
    }

    async parsePage() {
        const productLinks = await this.driver.findElements(By.css('.title a'))

        const productUrls = []

        // Extraction of urls
        let f = !this.last_product_url
        for(const productLink of productLinks) {
            const url = await productLink.getAttribute('href')
            if(!f) {
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

        for(const product_url of productUrls) {
            await this.pause()
            //this.last_product_url = (
            await this.updateEntity('sites',
                { last_product_url: product_url }, { name: this.SITE }).last_product_url
            await this.driver.get(product_url)
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
            try{
                const h1Element = await this.driver.findElement(By.css('h1 span'))
                product.name = await h1Element.getText()
            }
            catch(e) {
                console.log('Error while getting product name')
            }

            product.spec = {}

            const detailElements = await this.driver.findElements(By.css('.productDetails .voc-group'))

            for(const detailElement of detailElements) {
                const nameElement = await detailElement.findElement(By.css('.voc-name'))
                const valueElement = await detailElement.findElement(By.css('a'))

                const name = (await nameElement.getText()).trim().split(':')[0]
                const value = (await valueElement.getText()).trim()

                product.spec[name] = value
            }
            
            this.currentProduct = await this.saveEntity('products', product)
        }

        /* console.log('currentProduct', this.currentProduct)
        console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++') */

        const feedbackUrls = []
        const feedbackLinks = await this.driver.findElements(By.css('.reviewTitle a'))

        let f = !this.last_feedback_url
        for(const feedbackLink of feedbackLinks) {
            const url = await feedbackLink.getAttribute('href')
            if(!f) {
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
        console.log('All feedbacks: ', feedbackUrls)

        for(const feedback_url of feedbackUrls) {
            await this.pause()
            // Раньше тут было присвоение, но это ломает логику
            //this.last_feedback_url =
            await this.updateEntity('sites', { last_feedback_url: feedback_url },
                { name: this.SITE }).last_feedback_url
            await this.driver.get(feedback_url)
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

        if(feedback) {
            this.currentFeedback = feedback
        }
        else {
            feedback = {}

            // url
            feedback.url = await this.driver.getCurrentUrl()

            // product_id
            feedback.product_id = this.currentProduct.id

            // title
            try{
                const h2Element = await this.driver.findElement(By.css('h2 a'))
                feedback.title = (await h2Element.getText()).trim()
            }
            catch{}

            // score
            try{
                const starsElements = await this.driver.findElements(By.css('.authorBlock .fivestarWidgetStatic .on'))
                feedback.score = starsElements.length
            }
            catch{}

            // content
            try{
                let content = ''
                // if has <p> tags
                const paragraphElements = await this.driver.findElements(By.css('.description p'))
                if(paragraphElements.length) {
                    for(const paragraphElement of paragraphElements) {
                        const text = await paragraphElement.getText()
                        if(text && text !== ' ' && text !== '&nbsp;') {
                            content += ` ${text}`
                        }
                    }
                }
                else {
                    // if no <p> tags
                    const descriptionElement = await this.driver.findElement(By.xpath('//div[@itemprop="reviewBody"]'))
                    content += await descriptionElement.getText()
                }
                if(content) {
                    feedback.content = content
                }
            }
            catch{}

            // likes
            /* const likesElement = await this.driver.findElement(By.css('.RecommendRating-like span'))
            feedback.likes = +(await likesElement.getText()).trim() */

            // dislikes
            /* const dislikesElement = await this.driver.findElement(By.css('.RecommendRating-dislike span'))
            feedback.dislikes = +(await dislikesElement.getText()).trim() */

            // experience
            try{
                const experienceElement = await this.driver.findElement(By.css('.list-beforebody .first .item-data'));
                feedback.experience = (await experienceElement.getText()).trim()
            }
            catch{}
            

            // published_at
            try{
                const publishedAtElement = await this.driver.findElement(By.css('.dtreviewed meta'))
                feedback.published_at = await publishedAtElement.getAttribute('content')
            }
            catch{}

            // embed - отсутствует

            // author_name
            try{
                const authorElement = await this.driver.findElement(By.css(`div[itemprop='author'] a`))
                feedback.author_name = await authorElement.getText()
            }
            catch{}

            // recommend
            try{
                const recommendElement = await this.driver.findElement(By.css('.conclusion .verdict'))
                feedback.recommend = (await recommendElement.getText()) === 'рекомендует'
            }
            catch{}

            // author_respect - отсутствует

            console.log('feedback', feedback)
            //console.log('feedback_url', feedback.url)
            console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++')

            this.currentFeedback = await this.saveEntity('feedbacks', feedback)

            // photo
            try{
                const urls = []
                const imgElements = await this.driver.findElements(By.css('.inline-image img'))
                for(const imgElement of imgElements) {
                    const url = await imgElement.getAttribute('src')
                    urls.push(url)
                }
                urls.length && await this.savePhotos(urls)

                console.log('Count of photos: ' + urls.length)
            } catch {
                console.log('Error while saving photos')
            }

            // benefits
            try{
                const benefitElements = await this.driver.findElements(By.css('.ratio .plus ul li'))
                const benefits = []
                for(const benefitsElement of benefitElements) {
                    const content = (await benefitsElement.getText()).trim()
                    benefits.push({ content, type: true, feedback_id: this.currentFeedback.id })
                }
                benefits.length && await this.saveMany('benefits_shortcomings', benefits)

                console.log('Benefits: ', benefits)
            }
            catch (e) {
                console.log('Error benefits: ' + e)
            }

            // shortcoming
            try{
                const shortcomingElements = await this.driver.findElements(By.css('.ratio .minus ul li'))
                const shortcomings = []
                for(const shortcomingElement of shortcomingElements) {
                    const content = (await shortcomingElement.getText()).trim()
                    shortcomings.push({ content, type: false, feedback_id: this.currentFeedback.id })
                }
                shortcomings.length && await this.saveMany('benefits_shortcomings', shortcomings)

                console.log('Shortcomings: ', shortcomings)
            }
            catch (e) {
                console.log('Error shortcoming: ', e)
            }
        }

    }

}

function run_parser() {
    const parser = new IrecommendParser()

    parser.run().catch(e => {
            parser.errorLog(e)
            parser.stop()

            // Trying to re run
            setTimeout(run_parser, 60000)
        }
    )
}

run_parser()




