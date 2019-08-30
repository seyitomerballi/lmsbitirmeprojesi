import {promisify} from 'util';
import {Response} from 'express';
import {
  Authorized,
  BadRequestError,
  Body,
  ContentType,
  Controller,
  CurrentUser,
  Delete,
  ForbiddenError,
  Get,
  NotFoundError,
  Param,
  Post,
  Res,
  UseBefore
} from 'routing-controllers';
import passportJwtMiddleware from '../security/passportJwtMiddleware';
import {Unit} from '../models/units/Unit';
import {IDownload} from '../../../shared/models/IDownload';
import {IFileUnit} from '../../../shared/models/units/IFileUnit';
import {Lecture} from '../models/Lecture';
import {IUser} from '../../../shared/models/IUser';
import {Course} from '../models/Course';
import config from '../config/main';
import {errorCodes} from '../config/errorCodes';

import * as fs from 'fs';
import * as path from 'path';
import {File} from '../models/mediaManager/File';
import {ICourse} from '../../../shared/models/ICourse';
import * as mongoose from 'mongoose';
import {CreateOptions} from 'html-pdf';

import crypto = require('crypto');
import archiver = require('archiver');

const pdf = require('html-pdf');
const phantomjs = require('phantomjs-prebuilt');
const binPath = phantomjs.path;


// Set all routes which should use json to json, the standard is blob streaming data
@Controller('/download')
@UseBefore(passportJwtMiddleware)
export class DownloadController {

  private markdownCss: string;

  constructor() {
    setInterval(this.cleanupCache, config.timeToLiveCacheValue * 60);
    this.markdownCss = this.readMarkdownCss();
  }

  cleanupCache() {
    const expire = Date.now() - 3600 * 1000;
    const files = fs.readdirSync(config.tmpFileCacheFolder);

    for (const fileName of files) {
      if (/download_(\w+).zip/.test(fileName) === false) {
        continue;
      }

      const filePath = path.join(config.tmpFileCacheFolder, fileName);
      const fileStat = fs.statSync(filePath);

      if (fileStat.ctimeMs >= expire) {
        continue;
      }

      fs.unlinkSync(filePath);
    }
  }

  replaceCharInFilename(filename: string) {
    return filename.replace(/[^a-zA-Z0-9 -]/g, '')    // remove special characters
      .replace(/ /g, '-')             // replace space by dashes
      .replace(/-+/g, '-');
  }

  async calcPackage(pack: IDownload) {

    let localTotalSize = 0;
    const localTooLargeFiles: Array<String> = [];

    for (const lec of pack.lectures) {
      for (const unit of lec.units) {

        const localUnit = await Unit
          .findOne({_id: unit.unitId})
          .orFail(new NotFoundError());

        if (localUnit.__t === 'file') {
          const fileUnit = <IFileUnit><any>localUnit;
          fileUnit.files.forEach((file, index) => {
            if (unit.files.indexOf(index) > -1) {
              if ((file.size / 1024) > config.maxFileSize) {
                localTooLargeFiles.push(file.link);
              }
              localTotalSize += (file.size / 1024);
            }
          });
        }
      }
    }
    return {totalSize: localTotalSize, tooLargeFiles: localTooLargeFiles};
  }

  /**
   * @api {get} /api/download/:id Request archived file
   * @apiName GetDownload
   * @apiGroup Download
   *
   * @apiParam {String} id Course name.
   * @apiParam {Response} response Response (input).
   *
   * @apiSuccess {Response} response Response (output).
   *
   * @apiSuccessExample {json} Success-Response:
   *     UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==
   *
   * @apiError NotFoundError File could not be found.
   * @apiError ForbiddenError Invalid id i.e. filename (e.g. '../something').
   */
  @Get('/:id')
  async getArchivedFile(@Param('id') id: string, @Res() response: Response) {
    const tmpFileCacheFolder = path.resolve(config.tmpFileCacheFolder);
    const filePath = path.join(tmpFileCacheFolder, 'download_' + id + '.zip');

    // Assures that the filePath actually points to a file within the tmpFileCacheFolder.
    // This is because the id parameter could be something like '../forbiddenFile' ('../' via %2E%2E%2F in the URL).
    if (path.dirname(filePath) !== tmpFileCacheFolder) {
      throw new ForbiddenError(errorCodes.file.forbiddenPath.code);
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError();
    }

    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    await promisify<string, void>(response.download.bind(response))(filePath);
    return response;
  }

  async createFileHash() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * @api {post} /api/download/pdf/individual Post download request individual PDF
   * @apiName PostDownload
   * @apiGroup Download
   *
   * @apiParam {IDownload} data Course data.
   * @apiParam {IUser} currentUser Currently logged in user.
   *
   * @apiSuccess {String} hash Hash value.
   *
   * @apiSuccessExample {json} Success-Response:
   *     "da39a3ee5e6b4b0d3255bfef95601890afd80709"
   *
   * @apiError NotFoundError
   * @apiError ForbiddenError
   * @apiError BadRequestError
   */
  @Post('/pdf/individual')
  @ContentType('application/json')
  async postDownloadRequestPDFIndividual(@Body() data: IDownload, @CurrentUser() user: IUser) {
    if (!data.lectures.length) {
      throw new BadRequestError();
    }

    const course = await Course
      .findOne({_id: data.courseName})
      .orFail(new NotFoundError());

    this.userCanExportCourse(course, user);

    const size = await this.calcPackage(data);

    if (size.totalSize > config.maxZipSize || size.tooLargeFiles.length !== 0) {
      throw new BadRequestError();
    }

    const hash = await this.createFileHash();
    const filePath = path.join(path.resolve(config.tmpFileCacheFolder), 'download_' + hash + '.zip');
    const output = fs.createWriteStream(filePath);

    const archive = archiver('zip', {
      zlib: {level: 9}
    });

    archive.on('error', (err: Error) => {
      throw err;
    });

    archive.pipe(output);

    let lecCounter = 1;
    for (const lec of data.lectures) {

      const localLecture = await Lecture.findOne({_id: lec.lectureId});
      const lcName = this.replaceCharInFilename(localLecture.name);
      let unitCounter = 1;

      for (const unit of lec.units) {
        const localUnit = await Unit
          .findOne({_id: unit.unitId})
          .orFail(new NotFoundError());

        if (localUnit.__t === 'file') {
          for (const fileId of unit.files) {
            const file = await File.findById(fileId);
            archive.file('uploads/' + file.link, {name: lecCounter + '_' + lcName + '/' + unitCounter + '_' + file.name});
          }
        } else {

          const options: CreateOptions = {
            phantomPath: binPath,
            format: 'A4',
            border: {
              left: '1cm',
              right: '1cm'
            },
            footer: {
              contents: {
                default: '<div id="pageFooter">{{page}}/{{pages}}</div>'
              }
            }
          };

          let html = '<!DOCTYPE html>\n' +
            '<html>\n' +
            '  <head>' +
            '     <style>' +
            '       #pageHeader {text-align: center;border-bottom: 1px solid;padding-bottom: 5px;}' +
            '       #pageFooter {text-align: center;border-top: 1px solid;padding-top: 5px;}' +
            '       html,body {font-family: \'Helvetica\', \'Arial\', sans-serif; font-size: 12px; line-height: 1.5;}' +
            '       .codeBox {border: 1px solid grey; font-family: Monaco,Menlo,source-code-pro,monospace; padding: 10px}' +
            '       #firstPage {page-break-after: always;}' +
            '       .bottomBoxWrapper {height:800px; position: relative}' +
            '       .bottomBox {position: absolute; bottom: 0;}' + this.markdownCss +
            '     </style>' +
            '  </head>';
          html += await localUnit.toHtmlForIndividualPDF();
          html += '</html>';
          const name = lecCounter + '_' + lcName + '/' + unitCounter + '_' + this.replaceCharInFilename(localUnit.name) + '.pdf';
          const buffer = await this.createPdf(html, options);
          archive.append(buffer, {name});
        }
        unitCounter++;
      }
      lecCounter++;
    }

    return new Promise((resolve) => {
      output.on('close', () => resolve(hash));
      archive.finalize();
    });
  }

  /**
   * @api {post} /api/download/pdf/single Post download request single PDF
   * @apiName PostDownload
   * @apiGroup Download
   *
   * @apiParam {IDownload} data Course data.
   * @apiParam {IUser} currentUser Currently logged in user.
   *
   * @apiSuccess {String} hash Hash value.
   *
   * @apiSuccessExample {json} Success-Response:
   *     "da39a3ee5e6b4b0d3255bfef95601890afd80709"
   *
   * @apiError NotFoundError
   * @apiError ForbiddenError
   * @apiError BadRequestError
   */
  @Post('/pdf/single')
  @ContentType('application/json')
  async postDownloadRequestPDFSingle(@Body() data: IDownload, @CurrentUser() user: IUser) {
    if (!data.lectures.length) {
      throw new BadRequestError();
    }

    const course = await Course
      .findOne({_id: data.courseName})
      .orFail(new NotFoundError());

    this.userCanExportCourse(course, user);

    const size = await this.calcPackage(data);

    if (size.totalSize > config.maxZipSize || size.tooLargeFiles.length !== 0) {
      throw new BadRequestError();
    }

    data.courseName += 'Single';
    const hash = await this.createFileHash();
    const filePath = path.join(path.resolve(config.tmpFileCacheFolder), 'download_' + hash + '.zip');
    const output = fs.createWriteStream(filePath);

    const archive = archiver('zip', {
      zlib: {level: 9}
    });

    archive.on('error', (err: Error) => {
      throw err;
    });

    archive.pipe(output);

    const options: CreateOptions = {
      phantomPath: binPath,
      format: 'A4',
      border: {
        left: '1cm',
        right: '1cm',
        top: '0',
        bottom: '0'
      },
      footer: {
        contents: {
          default: '<div id="pageFooter">{{page}}/{{pages}}</div>'
        }
      },
      header: {
        contents: '<div id="pageHeader">' + course.name + '</div>',
        height: '20mm'
      }
    };

    let html = '<!DOCTYPE html>\n' +
      '<html>\n' +
      '  <head>' +
      '     <style>' +
      '       #pageHeader {text-align: center;border-bottom: 1px solid;padding-bottom: 5px;}' +
      '       #pageFooter {text-align: center;border-top: 1px solid;padding-top: 5px;}' +
      '       html, body {font-family: \'Helvetica\', \'Arial\', sans-serif; font-size: 12px; line-height: 1.5;}' +
      '       .codeBox {border: 1px solid grey; font-family: Monaco,Menlo,source-code-pro,monospace; padding: 10px}' +
      '       #firstPage {page-break-after: always;}' +
      '       #nextPage {page-break-before: always;}' +
      '       .bottomBoxWrapper {height:800px; position: relative}' +
      '       .bottomBox {position: absolute; bottom: 0;}' + this.markdownCss +
      '     </style>' +
      '  </head>' +
      '  <body>' +
      '  ';

    let solutions = '<div id="nextPage"><h2><u>Solutions</u></h2>';

    let lecCounter = 1;
    let firstSol = false;
    for (const lec of data.lectures) {

      const localLecture = await Lecture.findOne({_id: lec.lectureId});
      const lcName = this.replaceCharInFilename(localLecture.name);
      let unitCounter = 1;
      let solCounter = 1;
      if (lecCounter > 1) {
        html += '<div id="nextPage" ><h2>Lecture: ' + localLecture.name + '</h2>';
      } else {
        html += '<div><h2>Lecture: ' + localLecture.name + '</h2>';
      }

      for (const unit of lec.units) {
        const localUnit = await Unit
          .findOne({_id: unit.unitId})
          .orFail(new NotFoundError());

        if (localUnit.__t === 'file') {
          for (const fileId of unit.files) {
            const file = await File.findById(fileId);
            archive.file(path.join(config.uploadFolder, file.link),
              {name: lecCounter + '_' + lcName + '/' + unitCounter + '_' + file.name});
          }
        } else if ((localUnit.__t === 'code-kata' || localUnit.__t === 'task') && lecCounter > 1 && unitCounter > 1) {
          html += '<div id="nextPage" >' + await localUnit.toHtmlForSinglePDF() + '</div>';
        } else {
          html += await localUnit.toHtmlForSinglePDF();
        }

        if (localUnit.__t === 'code-kata' || localUnit.__t === 'task') {

          if (!firstSol && solCounter === 1) {
            solutions += '<div><h2>Lecture: ' + localLecture.name + '</h2>';
            firstSol = true;
          } else if (solCounter === 1) {
            solutions += '<div id="nextPage" ><h2>Lecture: ' + localLecture.name + '</h2>';
          } else {
            solutions += '<div id="nextPage" >';
          }
          solutions += await localUnit.toHtmlForSinglePDFSolutions() + '</div>';
          solCounter++;
        } else if (localUnit.__t !== 'file') {
          solutions += await localUnit.toHtmlForSinglePDFSolutions();
        }
        unitCounter++;
      }
      html += '</div>';
      lecCounter++;
    }
    html += solutions;
    html += '</div></body>' +
      '</html>';
    const name = this.replaceCharInFilename(course.name) + '.pdf';
    const buffer = await this.createPdf(html, options);
    archive.append(buffer, {name});

    return new Promise((resolve) => {
      output.on('close', () => resolve(hash));
      archive.finalize();
    });
  }

  private readMarkdownCss() {
    try {
      return fs.readFileSync(path.resolve(__dirname, '../../styles/md/bundle.css'), 'utf8');
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  private createPdf(html: string, options: CreateOptions): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      pdf.create(html, options).toBuffer((err: Error, buffer: Buffer) => {
        if (err) {
          reject(err);
        }
        resolve(buffer);
      });
    });
  }

  /**
   * @param course
   * @param user
   */
  private userCanExportCourse(course: ICourse, user: IUser): boolean {
    if (user.role === 'admin') {
      return true;
    }

    if (mongoose.Types.ObjectId(user._id).equals(course.courseAdmin._id)) {
      return true;
    }

    if (course.students.indexOf(user._id) !== -1) {
      return true;
    }

    if (course.teachers.indexOf(user._id) !== -1) {
      return true;
    }

    throw new ForbiddenError();
  }

  /**
   * @api {delete} /api/download/ Request to clean up the cache.
   * @apiName DeleteCache
   * @apiGroup Download
   * @apiPermission admin
   *
   * @apiSuccess {Object} result Empty object.
   *
   * @apiSuccessExample {json} Success-Response:
   *      {}
   */
  @Delete('/cache')
  @Authorized(['admin'])
  deleteCache() {
    this.cleanupCache();
    return {};
  }
}
