import {Injectable} from '@angular/core';
import {Subject} from 'rxjs/Subject';

@Injectable()
export class ShowProgressService {

  private toggleSidenavSource = new Subject<boolean>();
  toggleSidenav$ = this.toggleSidenavSource.asObservable();

  toggleLoadingGlobal(toggle: boolean) {
    this.toggleSidenavSource.next(toggle);
  }

}
