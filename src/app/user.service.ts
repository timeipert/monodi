import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userS: BehaviorSubject<User | null> = new BehaviorSubject<User | null>({
    user: "local-user",
    roles: ["admin"],
    token: "mock-local-token"
  });
  public  user:  Observable<User | null> = this.userS;

  constructor(private router: Router) {
  }

  public setUser(u: User): void {
    this.userS.next(u);
  }

  public logout(): void {
    // Local app doesn't really log out
    this.router.navigate(['/sources']);
  }
}

export interface User {
  roles: string[];
  token: string;
  user:  string;
}
