import {
  BadRequestError, Body, CurrentUser, Get, JsonController, Param, Put, UseBefore,
  ForbiddenError
} from 'routing-controllers';
import * as moment from 'moment';
import passportJwtMiddleware from '../security/passportJwtMiddleware';
import {errorCodes} from '../config/errorCodes';
import {Progress} from '../models/progress/Progress';
import {Course} from '../models/Course';
import {Unit, IUnitModel} from '../models/units/Unit';
import {IUser} from '../../../shared/models/IUser';

@JsonController('/progress')
@UseBefore(passportJwtMiddleware)
export class ProgressController {
  private static checkDeadline(unit: any) {
    if (unit.deadline && moment(unit.deadline).isBefore()) {
      throw new BadRequestError(errorCodes.progress.pastDeadline.text);
    }
  }

  /**
   * @api {get} /api/progress/units/:id Get unit progress
   * @apiName GetUnitProgress
   * @apiGroup Progress
   *
   * @apiParam {String} id Unit ID.
   *
   * @apiSuccess {Progress} progress Progress data or an empty object if no data is available.
   *
   * @apiSuccessExample {json} Success-Response:
   *     {
   *         "_id": "5ab2b9516fab4a3ae0cd6737",
   *         "done": false,
   *         "updatedAt": "2018-03-21T19:58:09.386Z",
   *         "createdAt": "2018-03-21T19:58:09.386Z",
   *         "unit": "5ab2b80a6fab4a3ae0cd672d",
   *         "course": "5a53c474a347af01b84e54b7",
   *         "answers": {
   *             "5ab2b80a6fab4a3ae0cd672e": {
   *                 "5ab2b80a6fab4a3ae0cd6730": true,
   *                 "5ab2b80a6fab4a3ae0cd672f": false
   *             },
   *             "5ab2b8dd6fab4a3ae0cd6734": {
   *                 "5ab2b8dd6fab4a3ae0cd6736": false,
   *                 "5ab2b8dd6fab4a3ae0cd6735": true
   *             },
   *             "5ab2b8dd6fab4a3ae0cd6731": {
   *                 "5ab2b8dd6fab4a3ae0cd6733": false,
   *                 "5ab2b8dd6fab4a3ae0cd6732": true
   *             }
   *         },
   *         "type": "task-unit-progress",
   *         "user": "5a037e6a60f72236d8e7c813",
   *         "__v": 0,
   *         "__t": "task-unit-progress",
   *         "id": "5ab2b9516fab4a3ae0cd6737"
   *     }
   *
   * @apiError ForbiddenError
   */
  @Get('/units/:id')
  async getUnitProgress(@Param('id') id: string, @CurrentUser() currentUser: IUser) {
    const unit = await Unit.findById(id);
    const course = await Course.findById(unit._course);
    if (!course.checkPrivileges(currentUser).userCanViewCourse) {
      throw new ForbiddenError();
    }
    const progress = await Progress.findOne({user: currentUser, unit: id});
    return progress ? progress.toObject({virtuals: true}) : {};
  }

  /**
   * @api {put} /api/progress/ Set progress for a unit (i.e. create or update it idempotently)
   * @apiName PutProgress
   * @apiGroup Progress
   *
   * @apiParam {String} id Progress ID.
   * @apiParam {Object} data New progress data.
   *
   * @apiSuccess {Progress} progress Updated progress.
   *
   * @apiSuccessExample {json} Success-Response:
   *     {
   *         "_id": "5ab2b9516fab4a3ae0cd6737",
   *         "done": false,
   *         "updatedAt": "2018-03-21T19:58:09.386Z",
   *         "createdAt": "2018-03-21T19:58:09.386Z",
   *         "unit": "5ab2b80a6fab4a3ae0cd672d",
   *         "course": "5a53c474a347af01b84e54b7",
   *         "answers": {
   *             "5ab2b80a6fab4a3ae0cd672e": {
   *                 "5ab2b80a6fab4a3ae0cd6730": true,
   *                 "5ab2b80a6fab4a3ae0cd672f": false
   *             },
   *             "5ab2b8dd6fab4a3ae0cd6734": {
   *                 "5ab2b8dd6fab4a3ae0cd6736": false,
   *                 "5ab2b8dd6fab4a3ae0cd6735": true
   *             },
   *             "5ab2b8dd6fab4a3ae0cd6731": {
   *                 "5ab2b8dd6fab4a3ae0cd6733": false,
   *                 "5ab2b8dd6fab4a3ae0cd6732": true
   *             }
   *         },
   *         "type": "task-unit-progress",
   *         "user": "5a037e6a60f72236d8e7c813",
   *         "__v": 0,
   *         "__t": "task-unit-progress",
   *         "id": "5ab2b9516fab4a3ae0cd6737"
   *     }
   *
   * @apiError ForbiddenError
   */
  @Put('/')
  async updateProgress(@Body() data: any, @CurrentUser() currentUser: IUser) {
    const unit: IUnitModel = await Unit.findById(data.unit);
    const course = await Course.findById(unit._course);
    if (!course.checkPrivileges(currentUser).userCanViewCourse) {
      throw new ForbiddenError();
    }
    ProgressController.checkDeadline(unit);

    data.user = currentUser._id;
    data.course = course._id;

    let progress = await Progress.findOne({user: currentUser, unit});
    if (!progress) {
      progress = await Progress.create(data);
    } else {
      progress.set(data);
      await progress.save();
    }

    return progress.toObject();
  }
}
