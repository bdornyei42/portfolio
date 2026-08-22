@echo off
setlocal
cd /d "%~dp0"

for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "STAMP=%%i"

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or not on PATH. Install it from https://git-scm.com/
  exit /b 1
)

echo ==================================================
echo   Backup 1 of 2: public portfolio repo
echo   (https://github.com/bdornyei42/portfolio)
echo   everything here EXCEPT private/ - see .gitignore
echo ==================================================
echo.

if not exist ".git" (
  echo Initializing local git repository...
  git init
  git branch -M main
)
git config user.name  >nul 2>&1 || git config user.name  "Bendeguz Dornyei"
git config user.email >nul 2>&1 || git config user.email "dornyeibende@gmail.com"

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo Adding remote origin -^> https://github.com/bdornyei42/portfolio.git
  git remote add origin "https://github.com/bdornyei42/portfolio.git"
)

git add -A
git commit -m "Backup %STAMP%"
if errorlevel 1 echo Nothing new to commit - public repo already up to date locally.

echo.
echo Pushing to GitHub (public)...
git push -u origin main
if errorlevel 1 (
  echo.
  echo -------------------------------------------------------------
  echo Public push FAILED. First push? Sign in to GitHub when prompted,
  echo and make sure the repo exists at:
  echo     https://github.com/bdornyei42/portfolio
  echo -------------------------------------------------------------
  exit /b 1
)

echo.
echo ==================================================
echo   Backup 2 of 2: private repo (real financial data)
echo   (private/ folder only - own history, own remote)
echo ==================================================
echo.

where gh >nul 2>&1
set "HAS_GH=%errorlevel%"

pushd private

if not exist ".git" (
  echo Initializing local git repository for private/...
  git init
  git branch -M main
)
git config user.name  >nul 2>&1 || git config user.name  "Bendeguz Dornyei"
git config user.email >nul 2>&1 || git config user.email "dornyeibende@gmail.com"

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  if not "%HAS_GH%"=="0" (
    echo GitHub CLI ^(gh^) not found - can't auto-create the private repo.
    echo Install it from https://cli.github.com/, or add a remote yourself:
    echo     cd private
    echo     git remote add origin ^<your private repo URL^>
    popd
    exit /b 1
  )
  gh repo view bdornyei42/portfolio-private >nul 2>&1
  if errorlevel 1 (
    echo Creating private GitHub repo bdornyei42/portfolio-private ...
    gh repo create bdornyei42/portfolio-private --private --source=. --remote=origin
  ) else (
    echo Linking existing private repo bdornyei42/portfolio-private ...
    git remote add origin "https://github.com/bdornyei42/portfolio-private.git"
  )
)

git add -A
git commit -m "Backup %STAMP%"
if errorlevel 1 echo Nothing new to commit - private repo already up to date locally.

echo.
echo Pushing to GitHub (private)...
git push -u origin main
if errorlevel 1 (
  echo.
  echo -------------------------------------------------------------
  echo Private push FAILED. Check that bdornyei42/portfolio-private
  echo exists and you have access, then run save.bat again.
  echo -------------------------------------------------------------
  popd
  exit /b 1
)

popd

echo.
echo Backup complete: both repos committed locally and pushed to GitHub.
endlocal
