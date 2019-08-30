const appRoot = require('app-root-path');

export default {
  // Secret key for JWT signing and encryption
  secret: process.env.SECRET || 'notSoSecret234oi23o423ooqnafsnaaslfj',

  // BaseUrl for Webfrontend
  baseurl: process.env.BASEURL || 'http://localhost:4200',

  // Database connection information
  database: `mongodb+srv://seyit:fb123321@cluster0-upybo.mongodb.net/test?retryWrites=true&w=majority`,
  databaseOptions: {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false
  },

  // Setting port for server
  port: process.env.PORT || 3030,

  // Email configuration
  // for provider see https://nodemailer.com/smtp/well-known/
  // Use either Provider or SMTPServer/Port
  mailProvider: process.env.MAILPROVIDER || 'DebugMail',
  mailSMTPServer: process.env.MAILSMTPSERVER || undefined,
  mailSMTPPort: process.env.MAILSMTPPORT || 25,
  mailAuth: {
    user: process.env.MAILUSER || undefined,
    pass: process.env.MAILPASS || ''
  },
  mailSender: process.env.MAILSENDER || 'seyit.balli@ogr.sakarya.edu.tr',

  teacherMailRegex: process.env.TEACHER_MAIL_REGEX || '^.+@.+\..+$',
  nonProductionWarning: process.env.NONPRODUCTIONWARNING || undefined,

  sentryDsn: process.env.SENTRY_DSN,
  sentryDsnPublic: process.env.SENTRY_DSN_PUBLIC,

  timeToLiveCacheValue: 3600,
  tmpFileCacheFolder: appRoot + '/tmp/',
  maxFileSize: 51200,
  maxZipSize: 204800,

  uploadFolder: process.env.UPLOADFOLDER || (appRoot + '/uploads/'),
  maxProfileImageWidth: 512,
  maxProfileImageHeight: 512,

  timeTilNextActivationResendMin: 10,
};
