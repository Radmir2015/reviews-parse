const { Pool } = require('pg')
const pg_format = require('pg-format')
const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
//const chrome = require('selenium-webdriver/chrome')
const path = require('path')
const firefox = require('selenium-webdriver/firefox')
const Jimp = require('jimp')
const sharp = require('sharp')
const cyrillicToTranslit = require('cyrillic-to-translit-js')
const md5 = require('crypto-js/md5')
const { createLogger, format, transports } = require("winston")
const { combine, timestamp, prettyPrint } = format
const fs = require('fs').promises;

const { postgres } = require('./config')

class AbstractParser {

    constructor() {
        this.imageSizes = [
            { name: 'tiny', value: 50 },
            { name: 'small', value: 100 },
            { name: 'medium', value: 250 },
        ]

        const errorLogger = createLogger({
            format: combine(
                timestamp(),
                prettyPrint()
            ),
            transports: [
                new transports.File({
                    level: "error",
                    filename: path.join(__dirname, 'logs', 'error.log')
                })
            ]
        })

        this.errorLog = (error, info) => {
            console.error(error)
            const level = "error"
            const message = info ? `Info: ${info}, ${error.stack}` : error.stack
            errorLogger.log({ level, message })
        }

        this.config = postgres

        this.translit = cyrillicToTranslit()

        this.driver = null
        this.manage = null
        this.db = null

        this.last_page = null
        this.last_product_url = null
        this.last_feedback_url = null

        this.categories = null
        this.currentCategory = null
        this.currentProduct = null
        this.currentFeedback = null
    }

    async init() {
        //const options = new firefox.Options().setBinary(browserPath).headless()
        //const options = new firefox.Options().addArguments(`--binary=${browserPath}`).headless()

        /* this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(new chrome.Options().addArguments(`--no-sandbox`).addArguments(`--disable-dev-shm-usage`).headless())
            .build() */

        /*const capabilities = new Capabilities({
            "moz:firefoxOptions": {
                binary: `${__dirname}/geckodriver`
            }
        }).setBrowserName('firefox') */
        // console.log('Starting to build a browser...')
        this.driver = await new Builder()
        .forBrowser('firefox')
        .setFirefoxOptions(
            new firefox.Options()
                .headless()
            )
            .build()
        // console.log('The browser is built...')
        
        // console.log('Openning browser...')
        this.manage = this.driver.manage()
        // console.log('The browser is opened!')
        // console.log('Connecting to the database...')
        this.db = new Pool(this.config)
        
        await this.db.connect()
        // console.log('Connected to the database!')

        this.categories = (await this.db.query(
            `select c.url as url, c.id as id, s.last_page as last_page, s.last_product_url as last_product_url
            from public.categories c
            inner join public.sites s on c.site_id = s.id
            where s.name = $1 and c.parsing = true`, [this.SITE])).rows
    }

    async run() {
        await this.init()
    }

    async saveEntity(table, data) {
        const fields = []
        const values = []
        const indexes = []
        let i = 0

        for (const key in data) {
            i++
            fields.push(key)
            values.push(data[key])
            indexes.push(`$${i}`)
        }

        let query = `INSERT INTO ${table} (${fields.join(
            ", "
        )}) VALUES (${indexes.join(", ")}) returning *`

        const result = await this.db.query(query, values)
        const row = result.rows[0]

        row.id = +row.id

        return row
    }

    async updateEntity(table, data, where) {
        const fields = []
        const values = []
        const dataFields = Object.keys(data);
        dataFields.forEach((field, i) => {
            fields.push(`${field} = $${i + 1}`)
            values.push(data[field])
        })
        let query = `UPDATE ${table} SET ${fields.join(', ')}`

        let index = values.length
        let where_string

        if(where) {
            const wheres = [];
            const whereFields = Object.keys(where)
            whereFields.forEach(field => {
                wheres.push(`${field} = $${++index}`)
                values.push(where[field])
            })
            where_string = wheres.join(" AND ")
        }
        
        if(where_string) {
            query += ` WHERE ${where_string} returning *`
        }
        const result = await this.db.query(query, values)
        const row = result.rows[0]
        if(row) {
            row.id = +row.id
        }
        return row
    }

    async saveMany(table, list) {
        const fields = Object.keys(list[0])
        const data = list.map(Object.values)
        const query = pg_format(`INSERT INTO ${table} (${fields.join(", ")}) VALUES %L`, data)
        await this.db.query(query)
    }

    async savePhotos(urls, entity) {
        const data = []
        
        for(let i = 0; i < urls.length; i++) {
            try{
                const image = await Jimp.read(urls[i])
                const buffer = await image.getBufferAsync(Jimp.MIME_JPEG)
                const sharpImage = sharp(buffer)
                const metadata = await sharpImage.metadata()
                const side = metadata.height > metadata.width ? 'height' : 'width'
                const name = `${this.translit.transform(this.currentProduct.name.toLowerCase(), '-')}_${this.currentFeedback ? this.currentFeedback.id + '_' : ''}${i}`
                
                const parentEntity = entity ? entity : { feedback_id: this.currentFeedback.id }

                const parentPhoto = await this.saveEntity('photos', { 
                    url: urls[i], 
                    size: 'full',
                    ...parentEntity
                })

                for(const size of this.imageSizes) {
                    const url = `${name.replace(/[",\/]+/g, '')}_${size.name}.webp`
                    const savePath = path.join(__dirname, 'images', this.SITE, this.currentCategory.url.split('/').slice(-2)[0], url)

                    await fs.mkdir(path.join(__dirname, 'images', this.SITE, this.currentCategory.url.split('/').slice(-2)[0]), { recursive: true })

                    await sharpImage
                        .resize({ [side]: size.value })
                        .toFormat('webp')
                        .toFile(savePath)

                    data.push({ 
                        url, 
                        ...parentEntity, 
                        size: size.name,
                        parent_id: parentPhoto.id
                    })
                }
            }
            catch(e){
                console.error("SAVE_PHOTO_ERROR", e)
                this.errorLog(e, `SAVE_PHOTO_ERROR, product_id: ${this.currentProduct.id}`)
            }
        }
        data.length && await this.saveMany('photos', data)
    }

    async getEntity(table, where) {
        const values = []
        let query = `SELECT * FROM ${table}`
        let index = values.length
        let where_string

        if(where) {
            const wheres = [];
            const whereFields = Object.keys(where)
            whereFields.forEach(field => {
                wheres.push(`${field} = $${++index}`)
                values.push(where[field])
            })
            where_string = wheres.join(" AND ")
        }
        
        if(where_string) {
            query += ` WHERE ${where_string}`
        }

        const result = await this.db.query(query, values)
        if(result.rows[0]) {
            result.rows[0].id = +result.rows[0].id
        }

        return result.rows[0]
    }

    md5(text) {
        return md5(text).toString()
    }

    async pause(interval = 1000) {
        return new Promise(resolve => setTimeout(resolve, interval))
    }

    async stop() {
        this.driver && await this.driver.quit()
        // process.exit(0)
    }
}

module.exports = AbstractParser
